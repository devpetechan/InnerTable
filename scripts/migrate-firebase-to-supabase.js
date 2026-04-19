#!/usr/bin/env node
/**
 * IT-029: One-time data migration script
 * Firebase RTDB → Supabase (Postgres)
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   cd scripts && npm install
 *
 *   # Dry-run (safe, no writes):
 *   node migrate-firebase-to-supabase.js
 *
 *   # Execute (actually writes to Supabase):
 *   node migrate-firebase-to-supabase.js --execute
 *
 * ── SETUP (one-time, before first run) ──────────────────────────────────────
 *   1. cd scripts && npm install
 *   2. Create the file  scripts/.env.migration  with this content:
 *        SUPABASE_SERVICE_ROLE_KEY=<your key>
 *      Get it from: Supabase dashboard → Project Settings → API → service_role key
 *   3. Make sure scripts/.env.migration is in .gitignore (it already is if you
 *      used the root .gitignore that ships with this project).
 *      ⚠️  NEVER commit the service role key — it bypasses all security.
 *
 * ── WHAT THIS SCRIPT DOES ───────────────────────────────────────────────────
 *   Step 1 — Read every recommendation (+ nested comments/votes/ratings)
 *             from Firebase Realtime Database via its REST API.
 *   Step 2 — Collect every unique nickname that appears as an author,
 *             commenter, voter, or rater.
 *   Step 3 — Look up Supabase auth users whose display_name matches a nickname.
 *   Step 4 — For unmatched nicknames, create a placeholder Supabase auth user
 *             (email: <nickname>-placeholder@innertable.local).
 *             When that person later signs in with Google, we can link accounts.
 *   Step 5 — Build rows for public.recommendations, public.comments,
 *             and public.votes.
 *   Step 6 — Write those rows to Supabase (skipped in dry-run mode).
 *   Step 7 — Write scripts/nickname-uuid-map.json as an audit trail.
 *
 * ── DEPENDENCIES ────────────────────────────────────────────────────────────
 *   Prerequisites: IT-026 (users table), IT-028 (recs/comments/votes tables)
 *   must be applied to Supabase before running --execute.
 */

'use strict';

// ─── Node built-ins ──────────────────────────────────────────────────────────
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');    // crypto.randomUUID() — built into Node 18+

// ─── Third-party ─────────────────────────────────────────────────────────────
// Load the service role key from scripts/.env.migration before anything else.
require('dotenv').config({ path: path.join(__dirname, '.env.migration') });

const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ───────────────────────────────────────────────────────────

const FIREBASE_DB_URL  = 'https://innertable-default-rtdb.firebaseio.com';
const SUPABASE_URL     = 'https://eaufghntbhnbewexphjj.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The --execute flag must be explicitly passed; default is a safe dry-run.
const DRY_RUN = !process.argv.includes('--execute');

// Audit file written after a successful --execute run.
const MAP_OUTPUT_PATH = path.join(__dirname, 'nickname-uuid-map.json');

// ─── Preflight checks ────────────────────────────────────────────────────────

if (!SERVICE_ROLE_KEY) {
  console.error('\n❌  SUPABASE_SERVICE_ROLE_KEY is not set.');
  console.error('    Create the file  scripts/.env.migration  with:');
  console.error('      SUPABASE_SERVICE_ROLE_KEY=<your key>\n');
  process.exit(1);
}

// ─── Supabase client ─────────────────────────────────────────────────────────
//
// We use the SERVICE ROLE key here, not the anon key.
//
// 🎓  Learning note:
//   The anon key is safe to put in client-side code. It's like a "public"
//   credential — Supabase's Row Level Security (RLS) policies act as a
//   gatekeeper and restrict what each authenticated user can see/write.
//
//   The service role key is a superuser key that BYPASSES RLS entirely.
//   That's exactly what we need for a migration script (we want to write
//   data on behalf of many users at once), but it must NEVER go in
//   client-side code or be committed to git.
//
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ─── Logging helpers ─────────────────────────────────────────────────────────

const log  = (msg) => console.log(msg);
const info = (msg) => console.log(`   ℹ️  ${msg}`);
const ok   = (msg) => console.log(`   ✅ ${msg}`);
const warn = (msg) => console.log(`   ⚠️  ${msg}`);

// ─── Helper: Firebase REST fetch ─────────────────────────────────────────────
//
// 🎓  Learning note:
//   Firebase Realtime Database has a REST API — you can append ".json" to any
//   path in your database URL and GET/POST/PATCH/DELETE data without the SDK.
//   We use this here because it's simpler than pulling in the full Firebase
//   Admin SDK just for a one-time read.
//
//   Node 18+ includes the global `fetch` function (same API as browsers),
//   so no extra package is needed.
//
async function fetchFirebase(dbPath) {
  const url = `${FIREBASE_DB_URL}/${dbPath}.json`;
  const res  = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Firebase returned ${res.status}. Your database rules may require authentication.\n` +
      `  Option A: Temporarily set rules to allow reads, run the script, then restore rules.\n` +
      `  Option B: Contact the project owner for a service account JSON.`
    );
  }

  if (!res.ok) {
    throw new Error(`Firebase fetch failed: ${res.status} ${res.statusText} — URL: ${url}`);
  }

  return res.json();
}

// ─── Helper: convert Firebase timestamp → ISO string ─────────────────────────
//
// 🎓  Learning note:
//   Firebase stores timestamps as milliseconds since the Unix epoch (Jan 1 1970).
//   Postgres/Supabase expects ISO 8601 strings like "2025-03-01T14:30:00Z".
//   JavaScript's Date class handles the conversion easily.
//
function msToISO(ms) {
  if (!ms || typeof ms !== 'number') return new Date().toISOString();
  return new Date(ms).toISOString();
}

// ─── Helper: transform reactions (nickname keys → UUID keys) ─────────────────
//
// Firebase reactions shape: { "❤️": { "Peter": true, "Alice": true } }
// Supabase reactions shape: { "❤️": { "<uuid>": true, "<uuid>": true } }
//
// We need to swap nickname keys for UUIDs so the app can match them against
// the currently signed-in user's ID.
//
function transformReactions(rawReactions, nicknameUUIDMap) {
  if (!rawReactions || typeof rawReactions !== 'object') return {};

  const transformed = {};
  for (const [emoji, reactors] of Object.entries(rawReactions)) {
    if (!reactors || typeof reactors !== 'object') continue;
    transformed[emoji] = {};
    for (const [nickname, val] of Object.entries(reactors)) {
      const uuid = nicknameUUIDMap[nickname];
      if (uuid) {
        transformed[emoji][uuid] = val;
      } else {
        warn(`No UUID for reactor "${nickname}" on emoji ${emoji} — skipping reaction`);
      }
    }
  }
  return transformed;
}

// ─── Helper: generate a deterministic fake UUID for dry-run display ──────────
//
// In dry-run mode we don't create real auth users, so we manufacture a
// recognizable fake UUID so the rest of the dry-run output is readable.
//
function fakeDryRunUUID(nickname) {
  // Hash the nickname to get a stable hex string, then format as UUID.
  const hash = crypto.createHash('sha1').update(nickname).digest('hex');
  return `00000000-0000-0000-${hash.slice(0, 4)}-${hash.slice(4, 16)}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  IT-029: Firebase RTDB → Supabase Migration');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN  (no data will be written)' : '🚀 EXECUTE  (writing to Supabase)'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // ── Step 1: Read all Firebase data ────────────────────────────────────────

  log('Step 1 ─ Reading recommendations from Firebase RTDB…');
  const rawRecs = await fetchFirebase('recommendations');

  if (!rawRecs || typeof rawRecs !== 'object') {
    warn('No recommendations found in Firebase. Nothing to migrate.');
    return;
  }

  const firebaseEntries = Object.entries(rawRecs);   // [ [firebaseId, rec], … ]
  log(`   Found ${firebaseEntries.length} recommendations.\n`);

  // ── Step 2: Collect every unique nickname ─────────────────────────────────

  log('Step 2 ─ Collecting all unique nicknames…');
  const nicknameSet = new Set();

  for (const [, rec] of firebaseEntries) {
    if (rec.author)      nicknameSet.add(rec.author);

    // votes:       { nickname: 'up' | 'down' | null }
    if (rec.votes) {
      for (const nickname of Object.keys(rec.votes)) nicknameSet.add(nickname);
    }

    // comments:    { commentKey: { author, text, ts, deleted, reactions } }
    if (rec.comments) {
      for (const comment of Object.values(rec.comments)) {
        if (comment?.author) nicknameSet.add(comment.author);
        // reactions: { "❤️": { nickname: true } }
        if (comment?.reactions) {
          for (const reactors of Object.values(comment.reactions)) {
            if (reactors && typeof reactors === 'object') {
              for (const nickname of Object.keys(reactors)) nicknameSet.add(nickname);
            }
          }
        }
      }
    }

    // userRatings / userStatuses: { nickname: … }
    if (rec.userRatings)  for (const n of Object.keys(rec.userRatings))  nicknameSet.add(n);
    if (rec.userStatuses) for (const n of Object.keys(rec.userStatuses)) nicknameSet.add(n);
  }

  const nicknames = [...nicknameSet];
  log(`   Found ${nicknames.length} unique nickname(s): ${nicknames.join(', ')}\n`);

  // ── Step 3: Match nicknames to existing Supabase auth users ───────────────

  log('Step 3 ─ Looking up existing Supabase auth users…');

  // supabase.auth.admin requires the service role key (set above).
  // listUsers returns up to `perPage` records; 1 000 is well above our alpha size.
  const { data: { users: authUsers }, error: listErr } =
    await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (listErr) throw new Error(`Could not list auth users: ${listErr.message}`);
  log(`   Found ${authUsers.length} existing auth user(s) in Supabase.`);

  // Build a map: display_name (lowercase) → UUID, for case-insensitive matching.
  const displayNameToUUID = {};
  for (const u of authUsers) {
    const name = (u.user_metadata?.display_name || u.email || '').toLowerCase();
    displayNameToUUID[name] = u.id;
  }

  // ── Step 4: Resolve / create placeholder users ────────────────────────────

  log('\nStep 4 ─ Resolving nicknames → UUIDs…');

  const nicknameUUIDMap  = {};     // Final mapping: nickname → Supabase UUID
  const matched          = [];     // Nicknames matched to existing auth users
  const placeholders     = [];     // Nicknames that needed new placeholder users

  for (const nickname of nicknames) {
    const existingUUID = displayNameToUUID[nickname.toLowerCase()];

    if (existingUUID) {
      // ✅  Already in Supabase — no action needed.
      nicknameUUIDMap[nickname] = existingUUID;
      matched.push(nickname);
      info(`Matched    "${nickname}"  →  ${existingUUID}`);

    } else {
      // 🆕  No auth user found — create a placeholder.
      //
      // 🎓  Learning note:
      //   A "placeholder" auth user reserves a UUID for this nickname so that
      //   historical data (recs, comments, votes) can reference a real FK.
      //   When the actual person signs in with Google later, we can update
      //   the public.users row to link to their real Google account.
      //
      const placeholderEmail =
        `${nickname.toLowerCase().replace(/[^a-z0-9]/g, '-')}-placeholder@innertable.local`;

      if (DRY_RUN) {
        // In dry-run mode we invent a stable fake UUID for illustration.
        nicknameUUIDMap[nickname] = fakeDryRunUUID(nickname);
        warn(`[DRY RUN] Would create placeholder: "${nickname}" <${placeholderEmail}>`);

      } else {
        info(`Creating placeholder auth user for "${nickname}"…`);

        const { data: newUser, error: createErr } =
          await supabase.auth.admin.createUser({
            email:         placeholderEmail,
            email_confirm: true,
            // user_metadata becomes raw_user_meta_data in the DB.
            // The handle_new_auth_user trigger reads display_name from here.
            user_metadata: { display_name: nickname, is_placeholder: true }
          });

        if (createErr) {
          // Handle re-runs: placeholder may already exist from a previous attempt.
          if (createErr.message.toLowerCase().includes('already')) {
            warn(`Placeholder already exists for "${nickname}" — searching for it…`);
            const { data: { users: fresh } } =
              await supabase.auth.admin.listUsers({ perPage: 1000 });
            const found = fresh.find(u => u.email === placeholderEmail);
            if (!found) throw new Error(`Cannot find placeholder for "${nickname}"`);
            nicknameUUIDMap[nickname] = found.id;
            info(`Reused existing placeholder  →  ${found.id}`);
          } else {
            throw new Error(`Failed to create placeholder for "${nickname}": ${createErr.message}`);
          }
        } else {
          nicknameUUIDMap[nickname] = newUser.user.id;
          placeholders.push(nickname);
          ok(`Created placeholder  "${nickname}"  →  ${newUser.user.id}`);
        }
      }
    }
  }

  log(`\n   Matched to existing users : ${matched.length}  (${matched.join(', ') || 'none'})`);
  log(`   Placeholder users created  : ${placeholders.length}  (${placeholders.join(', ') || 'none'})`);

  // ── Step 5: Build Supabase rows ────────────────────────────────────────────

  log('\nStep 5 ─ Building Supabase rows from Firebase data…');

  const recRows     = [];   // → public.recommendations
  const commentRows = [];   // → public.comments
  const voteRows    = [];   // → public.votes

  // Firebase ID → new Supabase UUID (needed to set recommendation_id on
  // comments and votes, since we're generating fresh UUIDs for recs).
  const firebaseIdToNewUUID = {};

  for (const [firebaseId, rec] of firebaseEntries) {
    const authorId = nicknameUUIDMap[rec.author];

    if (!authorId) {
      warn(`No UUID for author "${rec.author}" on rec "${firebaseId}" — skipping.`);
      continue;
    }

    // Generate a fresh UUID for this recommendation.
    //
    // 🎓  Learning note:
    //   crypto.randomUUID() produces a Version 4 UUID — a 128-bit random
    //   identifier. It's statistically near-impossible to get a collision.
    //   Example: "550e8400-e29b-41d4-a716-446655440000"
    //
    const recUUID = crypto.randomUUID();
    firebaseIdToNewUUID[firebaseId] = recUUID;

    // ── Recommendation row ──────────────────────────────────────────────────
    //
    // 🎓  Learning note — naming conventions:
    //   Firebase uses camelCase (e.g. placeType, factorRatings).
    //   Postgres/Supabase conventionally uses snake_case (place_type, factor_ratings).
    //   We translate here so the DB schema stays idiomatic.
    //
    recRows.push({
      id:              recUUID,
      author_id:       authorId,
      name:            rec.name            ?? null,
      place_type:      rec.placeType       ?? null,
      location:        rec.location        ?? null,
      lat:             rec.lat             ?? null,
      lng:             rec.lng             ?? null,
      google_place_id: rec.placeId         ?? null,
      status:          rec.status          ?? null,
      rating:          rec.rating          ?? null,
      cuisine:         rec.cuisine         ?? null,
      price:           rec.price           ?? null,
      notes:           rec.notes           ?? null,
      try_note:        rec.tryNote         ?? null,
      url:             rec.url             ?? null,
      // factor_ratings is stored as JSONB in Postgres — we pass the JS object
      // directly and Supabase serialises it.
      factor_ratings:  rec.factorRatings   ?? null,
      created_at:      msToISO(rec.ts),
      updated_at:      msToISO(rec.ts)
    });

    // ── Comment rows ────────────────────────────────────────────────────────
    if (rec.comments) {
      for (const [commentKey, comment] of Object.entries(rec.comments)) {
        if (!comment) continue;

        const commentAuthorId = nicknameUUIDMap[comment.author];
        if (!commentAuthorId) {
          warn(`No UUID for comment author "${comment.author}" (key ${commentKey}) — skipping.`);
          continue;
        }

        commentRows.push({
          // No `id` field: Supabase will auto-generate a UUID (DEFAULT gen_random_uuid()).
          recommendation_id: recUUID,
          author_id:         commentAuthorId,
          text:              comment.text    ?? null,
          deleted:           comment.deleted ?? false,
          // Transform reactions from nickname-keyed → UUID-keyed.
          reactions:         transformReactions(comment.reactions, nicknameUUIDMap),
          created_at:        msToISO(comment.ts),
          updated_at:        msToISO(comment.ts)
        });
      }
    }

    // ── Vote rows ────────────────────────────────────────────────────────────
    //
    // Firebase shape: votes: { "Peter": "up", "Alice": null }
    // null means the user toggled their vote off — skip those.
    //
    if (rec.votes) {
      for (const [voterNickname, voteValue] of Object.entries(rec.votes)) {
        if (!voteValue) continue;   // null = vote retracted

        const voterId = nicknameUUIDMap[voterNickname];
        if (!voterId) {
          warn(`No UUID for voter "${voterNickname}" — skipping vote.`);
          continue;
        }

        voteRows.push({
          recommendation_id: recUUID,
          user_id:           voterId,
          value:             voteValue   // 'up' or 'down'
          // created_at has a DEFAULT so we can omit it
        });
      }
    }
  }

  log(`\n   Prepared:`);
  log(`     ${recRows.length} recommendation row(s)  →  public.recommendations`);
  log(`     ${commentRows.length} comment row(s)        →  public.comments`);
  log(`     ${voteRows.length} vote row(s)            →  public.votes`);

  // ── Step 6: Write to Supabase ─────────────────────────────────────────────

  log('\nStep 6 ─ Writing to Supabase…');

  if (DRY_RUN) {
    log('\n   [DRY RUN] No writes performed. Preview of first recommendation row:');
    if (recRows[0]) {
      console.log(JSON.stringify(recRows[0], null, 6));
    }
    if (commentRows[0]) {
      log('\n   Preview of first comment row:');
      console.log(JSON.stringify(commentRows[0], null, 6));
    }
    if (voteRows[0]) {
      log('\n   Preview of first vote row:');
      console.log(JSON.stringify(voteRows[0], null, 6));
    }

  } else {
    // Write recommendations
    log('   Inserting recommendations…');
    const { error: recErr } = await supabase
      .from('recommendations')
      .insert(recRows);
    if (recErr) throw new Error(`Failed to insert recommendations: ${recErr.message}`);
    ok(`Inserted ${recRows.length} recommendations.`);

    // Write comments (skip if none)
    if (commentRows.length > 0) {
      log('   Inserting comments…');
      const { error: commentErr } = await supabase
        .from('comments')
        .insert(commentRows);
      if (commentErr) throw new Error(`Failed to insert comments: ${commentErr.message}`);
      ok(`Inserted ${commentRows.length} comments.`);
    }

    // Write votes (skip if none)
    if (voteRows.length > 0) {
      log('   Inserting votes…');
      const { error: voteErr } = await supabase
        .from('votes')
        .insert(voteRows);
      if (voteErr) throw new Error(`Failed to insert votes: ${voteErr.message}`);
      ok(`Inserted ${voteRows.length} votes.`);
    }
  }

  // ── Step 7: Write audit map file ──────────────────────────────────────────
  //
  // This JSON file is your paper trail:
  //   • Which nickname maps to which Supabase UUID
  //   • How many rows were (or would be) written
  //   • Whether this was a dry run or a real execute
  //
  log('\nStep 7 ─ Writing audit file…');

  const auditPayload = {
    generatedAt:   new Date().toISOString(),
    dryRun:        DRY_RUN,
    nicknameUUIDMap,
    rowCounts: {
      firebase:          firebaseEntries.length,
      recommendations:   recRows.length,
      comments:          commentRows.length,
      votes:             voteRows.length
    }
  };

  if (DRY_RUN) {
    log('   [DRY RUN] Would write to: ' + MAP_OUTPUT_PATH);
    log('   Audit payload:');
    console.log(JSON.stringify(auditPayload, null, 4));
  } else {
    fs.writeFileSync(MAP_OUTPUT_PATH, JSON.stringify(auditPayload, null, 2));
    ok(`Audit file written: ${MAP_OUTPUT_PATH}`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log('  ✅  Dry run complete. Zero data was modified.');
    console.log('  Run with --execute when you are ready to write to Supabase.');
    console.log('  Tip: node migrate-firebase-to-supabase.js --execute');
  } else {
    console.log('  ✅  Migration complete!');
    console.log(`  Audit file: ${MAP_OUTPUT_PATH}`);
    console.log('\n  Next steps:');
    console.log('    1. Verify row counts in the Supabase Table Editor.');
    console.log('    2. Spot-check 3+ entries: timestamps, ratings, factor ratings.');
    console.log('    3. Mark IT-029 as done in the backlog.');
  }
  console.log('══════════════════════════════════════════════════════════\n');
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\n❌  Migration failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
