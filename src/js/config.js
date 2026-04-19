// ══════════════════════════════════════════════════
//  CONFIG
//  ⚠️  SECURITY: ADMIN_PASSWORD must not stay in client-side code.
//  Replace with server-side auth before shipping to production.
// ══════════════════════════════════════════════════
const GOOGLE_MAPS_API_KEY = "AIzaSyBp_VQulJ05nnaVIhQuXY-7Wbc5MYGGmnA";
const ADMIN_USER     = "Admin";
const ADMIN_PASSWORD = "sactown";

// TODO: Move to a server-side environment / build-time injection before production.
// The anon key is safe to expose publicly (it only grants access Supabase's
// Row Level Security allows), but should not live in source control long-term.
const SUPABASE_URL      = "https://eaufghntbhnbewexphjj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhdWZnaG50YmhuYmV3ZXhwaGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MTk1NjMsImV4cCI6MjA5MjA5NTU2M30.6j6fO_vZ9U-cBaUC1Uy8vlMC_C1XuGNBJKvJ0bciNvc";

const firebaseConfig = {
  apiKey:            "AIzaSyDVemZ2c93K06gQRrMRdc3X-GTgkkElxfE",
  authDomain:        "innertable.firebaseapp.com",
  databaseURL:       "https://innertable-default-rtdb.firebaseio.com",
  projectId:         "innertable",
  storageBucket:     "innertable.firebasestorage.app",
  messagingSenderId: "902947609845",
  appId:             "1:902947609845:web:36dc2f183657d4ba9b39bc"
};

