// Load Google Maps + Places API
if (GOOGLE_MAPS_API_KEY !== "YOUR_GOOGLE_MAPS_API_KEY") {
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,marker&v=weekly&loading=async&callback=initGoogleAPIs&region=CA`;
  s.async = true; s.defer = true;
  document.head.appendChild(s);
} else {
  window.initGoogleAPIs = function() {};
}


//  MAP
// ══════════════════════════════════════════════════

// Called by Google Maps when the API key is invalid or has domain restrictions
window.gm_authFailure = function() {
  googleMapsReady = false;
  const mapEl = document.getElementById('map-view');
  if (mapEl) {
    mapEl.innerHTML = `<div class="map-empty" style="flex-direction:column;gap:8px;">
      <strong style="color:var(--text);">Maps JavaScript API not enabled</strong>
      <p style="font-size:.82rem;max-width:320px;line-height:1.5;">Go to <strong>Google Cloud Console → APIs &amp; Services → Library</strong>, search for <strong>"Maps JavaScript API"</strong>, and click Enable.</p>
    </div>`;
    mapInstance = null;
  }
};

function initGoogleAPIs() {
  googleMapsReady = true;
  initAutocomplete();
  // If map view was requested before API loaded, init now
  if (currentDisplayMode === 'map') initMap();
}

function initMap() {
  if (!googleMapsReady) {
    document.getElementById('map-view').innerHTML =
      '<div class="map-empty">Map loading…<br><small>If this persists, check your API key.</small></div>';
    return;
  }
  const mapEl = document.getElementById('map-view');
  if (mapEl.querySelector('.map-empty')) {
    mapEl.innerHTML = '';
    mapInstance = null;
  }
  if (!mapInstance) {
    mapInstance = new google.maps.Map(mapEl, {
      zoom: 10,
      center: { lat: 37.7749, lng: -122.4194 },
      mapId: 'DEMO_MAP_ID',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
  }
  renderMapMarkers();
}

function geocodePlace(place) {
  if (!googleMapsReady) return;
  const query = [place.name, place.location].filter(Boolean).join(', ');
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: query }, async (results, status) => {
    geocodingCache.delete(place.id);
    if (status !== 'OK' || !results[0]) return;
    const lat = results[0].geometry.location.lat();
    const lng = results[0].geometry.location.lng();
    // Save coords to the place row — Realtime re-renders the map.
    // NOTE: places currently has no UPDATE RLS policy (0007 only grants
    // SELECT/INSERT), so this write may silently no-op until a policy lands.
    await supabaseClient.from('places').update({ lat, lng }).eq('id', place.id);
  });
}

function renderMapMarkers() {
  if (!mapInstance) return;

  mapMarkers.forEach(m => m.setMap(null));
  mapMarkers = [];

  const noCoordsBanner = document.getElementById('map-no-coords');

  // IT-035: one pin per place (deduplicated by design — allPlaces is place-keyed)
  let places = Object.values(allPlaces);

  // Status filter — a place matches if any take matches
  if (currentView !== 'all') {
    places = places.filter(p => p.takes.some(t => {
      if (currentView === 'try')         return t.status === 'want-to-go';
      if (currentView === 'recommended') return t.status === 'been-recommend';
      if (currentView === 'no')          return t.status === 'been-skip';
      return true;
    }));
  }

  // Type filter
  if (currentTypeFilter !== 'all') {
    places = places.filter(p => p.placeType === currentTypeFilter);
  }

  // Lens filter (same as list view, v0.4.0): circle / mine / all
  places = places.filter(p => {
    if (currentFilter === 'all')  return true;
    if (currentFilter === 'mine') return p.takes.some(t => t.userId === currentUser.id);
    return p.takes.some(t =>
      t.userId === currentUser.id || _relationshipById[t.userId] === 'friends');
  });

  if (!places.length) {
    noCoordsBanner.style.display = 'block';
    return;
  }
  noCoordsBanner.style.display = 'none';

  // Geocode places that don't yet have coordinates (fire-and-forget; the
  // Realtime subscription re-renders once coords land)
  places.filter(p => !p.lat || !p.lng).forEach(p => {
    if (!geocodingCache.has(p.id)) {
      geocodingCache.add(p.id);
      geocodePlace(p);
    }
  });

  const withCoords = places.filter(p => p.lat && p.lng);
  if (!withCoords.length) return; // geocoding in progress — markers will appear on next re-render

  const bounds = new google.maps.LatLngBounds();

  withCoords.forEach(p => {
    const pos      = { lat: p.lat, lng: p.lng };
    const pinColor = p.placeType === 'bar' ? '#4B6B8A' : '#C1552E'; // design tokens: try-blue / clay

    const pinEl = document.createElement('div');
    pinEl.style.cssText = `width:16px;height:16px;border-radius:50%;background:${pinColor};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer;`;

    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: pos,
      map: mapInstance,
      title: p.name,
      content: pinEl,
    });

    marker.addListener('click', () => openPlaceDetail(p.id));

    mapMarkers.push(marker);
    bounds.extend(pos);
  });

  if (mapMarkers.length === 1) {
    mapInstance.setCenter(bounds.getCenter());
    mapInstance.setZoom(14);
  } else {
    mapInstance.fitBounds(bounds, { padding: 60 });
  }
}

// ══════════════════════════════════════════════════

//  GOOGLE PLACES AUTOCOMPLETE
// ══════════════════════════════════════════════════
async function initAutocomplete() {
  const input = document.getElementById('f-name');

  // Use importLibrary to correctly load the new Places API (New).
  // Accessing google.maps.places.AutocompleteSuggestion directly when
  // loading=async is used returns undefined, causing silent failures.
  const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
  let sessionToken = new AutocompleteSessionToken();

  const wrap = input.parentElement;
  const dropdown = document.createElement('ul');
  dropdown.id = 'places-dropdown';
  wrap.appendChild(dropdown);

  function hideDropdown() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }

  input.addEventListener('input', async () => {
    const val = input.value.trim();
    if (val.length < 2) { hideDropdown(); return; }

    try {
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: val,
        sessionToken,
      });

      if (!suggestions.length) { hideDropdown(); return; }

      dropdown.innerHTML = '';
      suggestions.slice(0, 5).forEach((s) => {
        const pred = s.placePrediction;
        const li   = document.createElement('li');
        li.className = 'pac-item-custom';
        li.innerHTML = `<span class="pac-main">${esc(pred.mainText.text)}</span>`
          + (pred.secondaryText ? `<span class="pac-secondary">${esc(pred.secondaryText.text)}</span>` : '');

        li.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          input.value = pred.mainText.text;
          hideDropdown();

          try {
            const place = pred.toPlace();
            await place.fetchFields({ fields: ['displayName','formattedAddress','types','priceLevel','location','id'] });

            if (place.displayName) input.value = place.displayName;
            if (place.formattedAddress) {
              const parts = place.formattedAddress.split(',');
              document.getElementById('f-location').value = parts.slice(1, 3).join(',').trim();
            }
            if (place.types) {
              const isBar = place.types.some(t => ['bar','night_club','liquor_store','wine_store'].includes(t));
              setPlaceType(isBar ? 'bar' : 'restaurant');
            }
            if (place.priceLevel != null) {
              const priceMap = {
                'INEXPENSIVE': '$', 'FREE': '$',
                'MODERATE': '$$', 'EXPENSIVE': '$$$', 'VERY_EXPENSIVE': '$$$$',
                1: '$', 2: '$$', 3: '$$$', 4: '$$$$'
              };
              const p = priceMap[place.priceLevel];
              if (p) setPrice(p); // keeps the price segmented control in sync
            }
            // Capture coordinates for map view
            if (place.location) {
              selectedPlaceLat = place.location.lat();
              selectedPlaceLng = place.location.lng();
            }
            // Store Place ID — submitEntry() uses it to attach to an
            // existing place silently (IT-036: no duplicate-prompt modal)
            if (place.id) {
              selectedPlaceId = place.id;
            }
          } catch (err) { console.error('Place detail fetch error:', err); }

          sessionToken = new AutocompleteSessionToken();
        });

        dropdown.appendChild(li);
      });

      dropdown.style.display = 'block';
    } catch (err) {
      console.error('Places autocomplete error:', err);
      hideDropdown();
    }
  });

  input.addEventListener('blur', () => setTimeout(hideDropdown, 200));
}

// ══════════════════════════════════════════════════
