(function () {
  'use strict';

  // --- SUPABASE SETUP ---
  const SUPABASE_URL = 'https://izrwdgnhpqdfmwhtrylt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_1cdquiCf2Vp2YA3MATaOOQ_l6Kwt0V5';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Mock data for fields not present in Supabase table to enrich the UI
  const MOCK_ADDRESSES = [
    { address: 'Av. Libertador 1500', commune: 'Santiago' },
    { address: 'Providencia 2124', commune: 'Providencia' },
    { address: 'Apoquindo 3478', commune: 'Las Condes' },
    { address: 'Av. Vitacura 2670', commune: 'Vitacura' },
    { address: 'Gran Avenida 5689', commune: 'San Miguel' },
    { address: 'Av. La Florida 8989', commune: 'La Florida' },
    { address: 'Pajaritos 2626', commune: 'Maipú' },
    { address: 'Av. Independencia 1234', commune: 'Independencia' },
    { address: 'Recoleta 567', commune: 'Recoleta' },
    { address: 'Santa Rosa 789', commune: 'Santiago' },
  ];

  // Map a single Supabase record to the format needed by this page.
  function mapSupabaseToStopData(item) {
    // Get location directly from the parsed JSONB object from Supabase
    const lat = item.location?.lat ?? -33.45;
    const lng = item.location?.lng ?? -70.6;
    
    const personCount = item.person_count;
    let status = 'low';
    if (personCount > 75) status = 'critical';
    else if (personCount > 50) status = 'high';
    else if (personCount > 20) status = 'medium';

    const mockData = MOCK_ADDRESSES[(item.id - 1) % MOCK_ADDRESSES.length];
    const avgWaitTimeMinutes = Math.max(1, personCount * 0.4 + (Math.random() * 4 - 2));
    const cameraCount = 1 + (item.id % 3);
    const cameras = Array.from({ length: cameraCount }, (_, i) => ({
      cameraId: `cam-${item.id}-${i + 1}`,
      status: Math.random() > 0.2 ? 'online' : 'offline',
      url: `https://picsum.photos/640/480?random=${item.id * 10 + i}`
    }));

    return {
      stopId: `stop-${item.id}`,
      timestamp: item.timestamp,
      location: {
        address: item.direccion || mockData.address,
        commune: mockData.commune,
        lat,
        lng
      },
      status,
      personCount,
      avgWaitTimeMinutes,
      cameras,
    };
  }

  // Fetches data for a single stop from Supabase
  async function getBusStopData(stopId) {
    const numericId = parseInt(stopId.replace('stop-', ''), 10);
    if (isNaN(numericId)) {
      return Promise.resolve(null);
    }

    const { data, error } = await supabase
      .from('paradero_mediciones')
      .select('*')
      .eq('id', numericId)
      .single();

    if (error) {
      console.error(`Error fetching stop ${stopId}:`, error);
      return null;
    }

    return mapSupabaseToStopData(data);
  }
  
  // --- THEME HELPER ---
  function applyTheme() {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // --- HELPERS ---
  const getStatusBorderClass = (status) => {
    switch (status) {
      case 'low': return 'border-green-500';
      case 'medium': return 'border-yellow-500';
      case 'high': return 'border-orange-500';
      case 'critical': return 'border-red-500';
      default: return 'border-gray-500';
    }
  };
  
  const getStatusBadgeClasses = (status) => {
    switch (status) {
      case 'low': return 'bg-green-200 text-green-800 dark:bg-green-700 dark:text-green-200';
      case 'medium': return 'bg-yellow-200 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200';
      case 'high': return 'bg-orange-200 text-orange-800 dark:bg-orange-700 dark:text-orange-200';
      case 'critical': return 'bg-red-200 text-red-800 dark:bg-red-700 dark:text-red-200';
      default: return 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  };
  
  const BUS_SERVICES = ['T101', 'T102', 'T103', 'T104', 'T105'];
  let activeBuses = [];
  let map;
  let busInterval;

  // --- DOM RENDER FUNCTIONS ---
  function renderStopInfo(stop) {
    document.getElementById('stop-id').textContent = stop.stopId;
    document.getElementById('stop-address').textContent = stop.location.address;
    document.getElementById('stop-commune').textContent = stop.location.commune;
    document.getElementById('stop-person-count').textContent = stop.personCount;
    document.getElementById('stop-wait-time').textContent = stop.avgWaitTimeMinutes.toFixed(1);
    
    const badge = document.getElementById('stop-status-badge');
    badge.textContent = stop.status;
    badge.className = `text-xs font-bold uppercase px-3 py-1 rounded-full flex-shrink-0 ${getStatusBadgeClasses(stop.status)}`;

    const card = document.getElementById('stop-info-card');
    card.className = 'bg-white dark:bg-gray-800 p-5 rounded-lg shadow-lg border-l-4'; // Reset classes
    card.classList.add(getStatusBorderClass(stop.status));
  }
  
  function renderCamera(camera) {
      document.getElementById('camera-id').textContent = `Cámara: ${camera.cameraId}`;
      const container = document.getElementById('camera-view');
      container.innerHTML = `
          <img src="${camera.url}" alt="Vista de la cámara ${camera.cameraId}" class="w-full h-auto object-contain max-h-[40vh] rounded-md ${camera.status === 'offline' ? 'grayscale' : ''}">
          <div class="absolute top-2 right-2 flex items-center text-xs font-bold text-white px-2 py-1 rounded-full ${camera.status === 'online' ? 'bg-green-500/90' : 'bg-red-500/90'}">
              <span class="w-2 h-2 rounded-full mr-1.5 ${camera.status === 'online' ? 'bg-green-300' : 'bg-red-300'}"></span>
              ${camera.status === 'online' ? 'Online' : 'Offline'}
          </div>
      `;
  }
  
  function initializeMap(location) {
    if (map) { map.remove(); }
    map = L.map('map').setView([location.lat, location.lng], 16);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20
    }).addTo(map);

    const stopIcon = L.divIcon({
      html: `<svg viewBox="0 0 24 24" class="w-10 h-10" fill="#3b82f6" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
      className: '', iconSize: [40, 40], iconAnchor: [20, 40]
    });
    L.marker([location.lat, location.lng], { icon: stopIcon }).addTo(map).bindPopup(`<b>Paradero:</b> ${location.address}`).openPopup();
  }

  // --- BUS SIMULATION ---
  function simulateApproachingBuses(stopLocation) {
    if (busInterval) { clearInterval(busInterval); }
    activeBuses.forEach(bus => map.removeLayer(bus.marker));
    activeBuses = [];
    
    const busListContainer = document.getElementById('approaching-buses-list');

    function createBus() {
      const service = BUS_SERVICES[Math.floor(Math.random() * BUS_SERVICES.length)];
      const eta = Math.floor(Math.random() * 300) + 60; // 1-6 minutes
      const offsetLat = (Math.random() - 0.5) * 0.02;
      const offsetLng = (Math.random() - 0.5) * 0.02;
      const startPos = { lat: stopLocation.lat + offsetLat, lng: stopLocation.lng + offsetLng };
      
      const busIcon = L.divIcon({
        html: `<div class="bg-gray-800 text-white text-xs font-bold rounded-md px-2 py-1 shadow-lg border-2 border-white">${service}</div>`,
        className: 'bus-marker', iconSize: [40, 20], iconAnchor: [20, 10]
      });
      
      const marker = L.marker([startPos.lat, startPos.lng], { icon: busIcon }).addTo(map);

      return { id: `bus-${Date.now()}`, service, eta, startEta: eta, startPos, marker };
    }

    function updateBusList() {
      const noBusesMsg = document.getElementById('no-buses-message');
      if (activeBuses.length === 0) {
        busListContainer.innerHTML = '';
        noBusesMsg.style.display = 'block';
        busListContainer.appendChild(noBusesMsg);
      } else {
        noBusesMsg.style.display = 'none';
        busListContainer.innerHTML = activeBuses.map(bus => `
          <div id="${bus.id}" class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg flex items-center justify-between">
            <div class="flex items-center"><div class="bg-blue-600 text-white font-bold rounded-md w-12 text-center py-1 mr-3">${bus.service}</div>
              <div><p class="font-semibold text-gray-800 dark:text-gray-200">Próximo en llegar</p><p class="text-xs text-gray-500 dark:text-gray-400">Desde una ubicación cercana</p></div>
            </div>
            <div class="text-right"><p class="font-bold text-lg text-blue-600 dark:text-blue-400">${Math.ceil(bus.eta / 60)} min</p></div>
          </div>`).join('');
      }
    }

    function updateBusPositions() {
      const arrivedBuses = [];
      activeBuses.forEach(bus => {
        bus.eta -= 1;
        if (bus.eta <= 0) {
          arrivedBuses.push(bus);
          return;
        }
        const progress = 1 - (bus.eta / bus.startEta);
        const newLat = bus.startPos.lat + (stopLocation.lat - bus.startPos.lat) * progress;
        const newLng = bus.startPos.lng + (stopLocation.lng - bus.startPos.lng) * progress;
        bus.marker.setLatLng([newLat, newLng]);
        const busElement = document.getElementById(bus.id);
        if(busElement) {
          busElement.querySelector('.font-bold.text-lg').textContent = `${Math.ceil(bus.eta / 60)} min`;
        }
      });
      arrivedBuses.forEach(bus => {
        map.removeLayer(bus.marker);
        activeBuses = activeBuses.filter(b => b.id !== bus.id);
      });
      if (Math.random() < 0.02 && activeBuses.length < 4) {
        activeBuses.push(createBus());
      }
      updateBusList();
    }
    for (let i = 0; i < 3; i++) { activeBuses.push(createBus()); }
    updateBusList();
    busInterval = setInterval(updateBusPositions, 1000);
  }

  // --- MAIN EXECUTION ---
  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const stopId = params.get('stopId');
    const cameraId = params.get('cameraId');

    if (!stopId || !cameraId) {
      document.getElementById('loading-state').style.display = 'none';
      document.getElementById('error-state').style.display = 'block';
      return;
    }

    getBusStopData(stopId).then(stop => {
      if (!stop) {
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('error-state').style.display = 'block';
        return;
      }
      
      const camera = stop.cameras.find(c => c.cameraId === cameraId);
      if (!camera) {
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('error-state').style.display = 'block';
        return;
      }

      document.title = `Detalle | ${stop.location.address}`;
      renderStopInfo(stop);
      renderCamera(camera);
      initializeMap(stop.location);
      simulateApproachingBuses(stop.location);

      document.getElementById('loading-state').style.display = 'none';
      document.getElementById('content-wrapper').style.display = 'block';
    });
  });

  window.addEventListener('storage', (event) => { if (event.key === 'theme') { applyTheme(); } });
  window.addEventListener('pageshow', () => { applyTheme(); });

})();