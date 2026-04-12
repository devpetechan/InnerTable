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
      <div style="font-size:2rem;">🗺️</div>
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
      '<div class="map-empty">🗺 Map loading…<br><small>If this persists, check your API key.</small></div>';
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

function geocodeEntry(id, r) {
  if (!googleMapsReady) return;
  const query = [r.name, r.location].filter(Boolean).join(', ');
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: query }, (results, status) => {
    geocodingCache.delete(id);
    if (status !== 'OK' || !results[0]) return;
    const lat = results[0].geometry.location.lat();
    const lng = results[0].geometry.location.lng();
    // Save coords to Firebase — the on('value') listener will auto re-render the map
    db.ref(`recommendations/${id}`).update({ lat, lng });
  });
}

function renderMapMarkers() {
  if (!mapInstance) return;

  mapMarkers.forEach(m => m.setMap(null));
  mapMarkers = [];

  const noCoordsBanner = document.getElementById('map-no-coords');

  let entries = Object.entries(allRecs);

  // Status filter
  entries = entries.filter(([,r]) => {
    if (currentView === 'try')         return r.status === 'try';
    if (currentView === 'recommended') return r.status === 'recommended';
    if (currentView === 'no')          return r.status === 'not-recommended';
    return true;
  });

  // Type filter
  if (currentTypeFilter !== 'all') {
    entries = entries.filter(([,r]) => r.placeType === currentTypeFilter);
  }

  // Friend/author filter (same as list view)
  entries = entries.filter(([,r]) => {
    if (currentFilter === 'all')  return true;
    if (currentFilter === 'mine') return r.author === currentUser;
    return r.author === currentFilter;
  });

  if (!entries.length) {
    noCoordsBanner.style.display = 'block';
    return;
  }
  noCoordsBanner.style.display = 'none';

  // Geocode entries that don't yet have coordinates (fire-and-forget; Firebase update re-renders)
  entries.filter(([,r]) => !r.lat || !r.lng).forEach(([id, r]) => {
    if (!geocodingCache.has(id)) {
      geocodingCache.add(id);
      geocodeEntry(id, r);
    }
  });

  const withCoords = entries.filter(([,r]) => r.lat && r.lng);
  if (!withCoords.length) return; // geocoding in progress — markers will appear on next re-render

  const bounds = new google.maps.LatLngBounds();

  withCoords.forEach(([id, r]) => {
    const pos      = { lat: r.lat, lng: r.lng };
    const pinColor = r.placeType === 'bar' ? '#4a6b7c' : '#c0522a';

    const pinEl = document.createElement('div');
    pinEl.style.cssText = `width:16px;height:16px;border-radius:50%;background:${pinColor};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer;`;

    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: pos,
      map: mapInstance,
      title: r.name,
      content: pinEl,
    });

    marker.addListener('click', () => openPlaceDetail(id));

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
  let sessionToken = new google.maps.places.AutocompleteSessionToken();

  const wrap = input.parentElement;
  const dropdown = document.createElement('ul');
  dropdown.id = 'places-dropdown';
  wrap.appendChild(dropdown);

  function hideDropdown() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }

  input.addEventListener('input', async () => {
    const val = input.value.trim();
    if (val.length < 2) { hideDropdown(); return; }

    try {
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
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
              if (p) document.getElementById('f-price').value = p;
            }
            // Capture coordinates for map view
            if (place.location) {
              selectedPlaceLat = place.location.lat();
              selectedPlaceLng = place.location.lng();
            }
            // Store Place ID for duplicate detection
            if (place.id) {
              selectedPlaceId = place.id;
              // Only check for duplicates when adding (not editing)
              if (!editingId) checkForDuplicate(place.id, place.displayName || input.value);
            }
          } catch (err) { console.error('Place detail fetch error:', err); }

          sessionToken = new google.maps.places.AutocompleteSessionToken();
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
