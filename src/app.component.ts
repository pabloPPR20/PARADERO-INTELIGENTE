// FIX: Import 'input' and 'output' from @angular/core to use the new signal-based component inputs/outputs.
import { Component, ChangeDetectionStrategy, signal, OnInit, OnDestroy, inject, computed, effect, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { BusStop } from './models/bus-stop.model';
import { BusStopService } from './services/bus-stop.service';
import { FormsModule } from '@angular/forms';

// Forward-declare Leaflet and Chart.js to avoid TypeScript errors
declare var L: any;
declare var Chart: any;

// --- Helper Functions ---
const getStatusClasses = (status: 'low' | 'medium' | 'high' | 'critical'): string => {
  switch (status) {
    case 'low': return 'bg-green-100 dark:bg-green-900/50 border-green-500 text-green-800 dark:text-green-300';
    case 'medium': return 'bg-yellow-100 dark:bg-yellow-900/50 border-yellow-500 text-yellow-800 dark:text-yellow-300';
    case 'high': return 'bg-orange-100 dark:bg-orange-900/50 border-orange-500 text-orange-800 dark:text-orange-300';
    case 'critical': return 'bg-red-100 dark:bg-red-900/50 border-red-500 text-red-800 dark:text-red-300';
    default: return 'bg-gray-100 dark:bg-gray-800 border-gray-500 text-gray-800 dark:text-gray-300';
  }
};

const getStatusBadgeClasses = (status: 'low' | 'medium' | 'high' | 'critical'): string => {
  switch (status) {
    case 'low': return 'bg-green-200 text-green-800 dark:bg-green-700 dark:text-green-200';
    case 'medium': return 'bg-yellow-200 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200';
    case 'high': return 'bg-orange-200 text-orange-800 dark:bg-orange-700 dark:text-orange-200';
    case 'critical': return 'bg-red-200 text-red-800 dark:bg-red-700 dark:text-red-200';
    default: return 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
};

const getStatusColor = (status: 'low' | 'medium' | 'high' | 'critical'): string => {
    switch (status) {
        case 'low': return '#4ade80';      // green-400
        case 'medium': return '#facc15';   // yellow-400
        case 'high': return '#fb923c';     // orange-400
        case 'critical': return '#f87171'; // red-400
        default: return '#9ca3af';         // gray-400
    }
}

// --- Main Application Component ---
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  providers: [DecimalPipe]
})
export class AppComponent implements OnInit, OnDestroy {
  private busStopService = inject(BusStopService);
  private cdr = inject(ChangeDetectorRef);

  // --- State Signals ---
  busStops = signal<BusStop[]>([]);
  loading = signal<boolean>(true);
  activeTab = signal<'map' | 'dashboard' | 'stops' | 'system'>('map');
  lastUpdated = signal<Date | null>(null);
  responseTime = signal<number>(0);
  isDarkMode = signal<boolean>(false);
  
  // --- Filter Signals for Stops Tab ---
  searchTerm = signal<string>('');
  statusFilter = signal<string>('all');
  communeFilter = signal<string>('all');
  
  // --- Computed Signals for Dashboard ---
  communes = computed(() => [...new Set(this.busStops().map(s => s.location.commune))].sort());
  totalStops = computed(() => this.busStops().length);
  totalPeople = computed(() => this.busStops().reduce((acc, s) => acc + s.personCount, 0));
  avgWaitTime = computed(() => {
    const stops = this.busStops();
    if (stops.length === 0) return 0;
    const totalWait = stops.reduce((acc, s) => acc + s.avgWaitTimeMinutes, 0);
    return totalWait / stops.length;
  });
  cameraStats = computed(() => {
    const allCameras = this.busStops().flatMap(s => s.cameras);
    const online = allCameras.filter(c => c.status === 'online').length;
    const total = allCameras.length;
    return { online, total, percentage: total > 0 ? (online / total) * 100 : 0 };
  });
  mostCongested = computed(() => [...this.busStops()].sort((a, b) => b.personCount - a.personCount).slice(0, 3));
  leastCongested = computed(() => [...this.busStops()].sort((a, b) => a.personCount - b.personCount).slice(0, 3));

  // --- Computed Signals for Filtering Stops ---
  filteredStops = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const status = this.statusFilter();
    const commune = this.communeFilter();
    
    return this.busStops().filter(stop => {
      const matchesSearch = stop.location.address.toLowerCase().includes(term) || stop.stopId.toLowerCase().includes(term);
      const matchesStatus = status === 'all' || stop.status === status;
      const matchesCommune = commune === 'all' || stop.location.commune === commune;
      return matchesSearch && matchesStatus && matchesCommune;
    });
  });

  // --- Leaflet Map and Chart.js instances ---
  @ViewChild('mapContainer', { static: false }) private mapContainer!: ElementRef;
  @ViewChild('congestionChart', { static: false }) private congestionChartCanvas!: ElementRef;
  @ViewChild('peopleByCommuneChart', { static: false }) private peopleByCommuneChartCanvas!: ElementRef;
  
  private map: any;
  private markers: any[] = [];
  private congestionChart: any;
  private peopleByCommuneChart: any;

  constructor() {
    effect(() => {
      if (this.activeTab() === 'map' && this.busStops().length > 0) {
        this.initMap();
      }
    });

    effect(() => {
      if (this.activeTab() === 'dashboard' && this.busStops().length > 0) {
        this.initCharts();
      }
    });

    // Effect to reactively manage the dark mode class on the <html> element
    effect(() => {
      if (this.isDarkMode()) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
    
    // Effect to update map/charts when data changes from real-time subscription
    effect(() => {
      const stops = this.busStops();
      if (stops.length > 0) {
        // Defer to allow view to render if needed
        setTimeout(() => {
          if (this.activeTab() === 'map') this.updateMapMarkers();
          if (this.activeTab() === 'dashboard') this.updateCharts();
        }, 0);
      }
    });
  }

  ngOnInit() {
    this.loadData();
    this.checkDarkMode();
    this.subscribeToRealtimeUpdates();
  }

  ngOnDestroy() {
    this.busStopService.unsubscribeFromChanges();
  }

  async loadData() {
    this.loading.set(true);
    const startTime = performance.now();
    const data = await this.busStopService.getBusStopDensity();
    const endTime = performance.now();
    
    this.busStops.set(data);
    this.lastUpdated.set(new Date());
    this.responseTime.set(endTime - startTime);
    this.loading.set(false);
  }

  private subscribeToRealtimeUpdates() {
    this.busStopService.subscribeToBusStopChanges(
      (updatedStop) => { // onUpdate
        this.busStops.update(stops => {
          const index = stops.findIndex(s => s.stopId === updatedStop.stopId);
          if (index !== -1) {
            stops[index] = updatedStop;
            return [...stops];
          }
          return stops;
        });
        this.lastUpdated.set(new Date());
      },
      (newStop) => { // onInsert
        this.busStops.update(stops => 
          [...stops, newStop]
            .sort((a, b) => parseInt(a.stopId.replace('stop-', '')) - parseInt(b.stopId.replace('stop-', '')))
        );
        this.lastUpdated.set(new Date());
      },
      (deletedStopId) => { // onDelete
        this.busStops.update(stops => stops.filter(s => s.stopId !== deletedStopId));
        this.lastUpdated.set(new Date());
      }
    );
  }
  
  // --- Tab Management ---
  changeTab(tab: 'map' | 'dashboard' | 'stops' | 'system') {
    this.activeTab.set(tab);
    // Use setTimeout to ensure DOM elements for the new tab are visible before initializing map/charts
    this.cdr.detectChanges(); // Manually trigger change detection
    setTimeout(() => {
      if (tab === 'map' && !this.map) this.initMap();
      if (tab === 'dashboard' && !this.congestionChart) this.initCharts();
    }, 0);
  }

  // --- UI Interaction ---
  navigateToParadero(stopId: string, cameraId: string) {
    window.location.href = `paradero.html?stopId=${stopId}&cameraId=${cameraId}`;
  }
  
  // --- Dark Mode ---
  toggleDarkMode() {
    this.isDarkMode.update(v => !v);
    localStorage.setItem('theme', this.isDarkMode() ? 'dark' : 'light');
    
    // Re-init charts with new colors for the new theme
    if (this.congestionChart) this.congestionChart.destroy();
    if (this.peopleByCommuneChart) this.peopleByCommuneChart.destroy();
    this.congestionChart = null;
    this.peopleByCommuneChart = null;
    setTimeout(() => { if (this.activeTab() === 'dashboard') this.initCharts() }, 0);
  }

  private checkDarkMode() {
    // Set the initial state of the signal from localStorage or user's preference
    if (localStorage.getItem('theme') === 'dark' || 
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      this.isDarkMode.set(true);
    } else {
      this.isDarkMode.set(false);
    }
  }

  // --- Map Logic (Leaflet) ---
  private initMap() {
    if (this.map || !this.mapContainer) return;
    
    this.map = L.map(this.mapContainer.nativeElement).setView([-33.45, -70.6], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(this.map);
    this.updateMapMarkers();
  }

  private updateMapMarkers() {
    if (!this.map) return;
    
    // Clear existing markers
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    this.busStops().forEach(stop => {
      const color = getStatusColor(stop.status);
      const icon = L.divIcon({
        html: `<svg viewBox="0 0 24 24" class="w-8 h-8" fill="${color}" stroke="white" stroke-width="1"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      const marker = L.marker([stop.location.lat, stop.location.lng], { icon }).addTo(this.map);
      marker.bindPopup(`
        <div class="font-sans">
          <strong class="text-lg">${stop.location.address}</strong>
          <p class="text-sm text-gray-600">${stop.stopId}</p>
          <hr class="my-2">
          <p><strong>Estado:</strong> <span style="color: ${color};">${stop.status.charAt(0).toUpperCase() + stop.status.slice(1)}</span></p>
          <p><strong>Personas:</strong> ${stop.personCount}</p>
          <p><strong>Espera:</strong> ${stop.avgWaitTimeMinutes.toFixed(1)} min</p>
        </div>
      `);
      this.markers.push(marker);
    });
  }

  // --- Chart Logic (Chart.js) ---
  private initCharts() {
    if (!this.congestionChartCanvas || !this.peopleByCommuneChartCanvas) return;
    
    const textColor = this.isDarkMode() ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';
    const gridColor = this.isDarkMode() ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

    // Destroy existing charts if they exist
    if (this.congestionChart) this.congestionChart.destroy();
    if (this.peopleByCommuneChart) this.peopleByCommuneChart.destroy();

    // Chart 1: Congestion Status Distribution
    const statusCounts = this.busStops().reduce((acc, stop) => {
        acc[stop.status] = (acc[stop.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    this.congestionChart = new Chart(this.congestionChartCanvas.nativeElement, {
        type: 'doughnut',
        data: {
            labels: ['Bajo', 'Medio', 'Alto', 'Crítico'],
            datasets: [{
                label: 'Estado de Paraderos',
                data: [statusCounts['low'] || 0, statusCounts['medium'] || 0, statusCounts['high'] || 0, statusCounts['critical'] || 0],
                backgroundColor: [getStatusColor('low'), getStatusColor('medium'), getStatusColor('high'), getStatusColor('critical')],
                borderColor: this.isDarkMode() ? '#1f2937' : '#ffffff',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: textColor } } }
        }
    });

    // Chart 2: People by Commune
    const peopleByCommune = this.busStops().reduce((acc, stop) => {
        acc[stop.location.commune] = (acc[stop.location.commune] || 0) + stop.personCount;
        return acc;
    }, {} as Record<string, number>);

    this.peopleByCommuneChart = new Chart(this.peopleByCommuneChartCanvas.nativeElement, {
        type: 'bar',
        data: {
            labels: Object.keys(peopleByCommune),
            datasets: [{
                label: 'Cantidad de Personas por Comuna',
                data: Object.values(peopleByCommune),
                backgroundColor: '#3b82f6', // blue-500
                borderColor: '#1d4ed8', // blue-700
                borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            },
            plugins: { legend: { display: false } }
        }
    });
  }

  private updateCharts() {
    if (!this.congestionChart || !this.peopleByCommuneChart) {
      this.initCharts(); // Initialize if not already
      return;
    }
    
    // Update Chart 1 data
    const statusCounts = this.busStops().reduce((acc, stop) => {
        acc[stop.status] = (acc[stop.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    this.congestionChart.data.datasets[0].data = [statusCounts['low'] || 0, statusCounts['medium'] || 0, statusCounts['high'] || 0, statusCounts['critical'] || 0];
    this.congestionChart.update();

    // Update Chart 2 data
    const peopleByCommune = this.busStops().reduce((acc, stop) => {
        acc[stop.location.commune] = (acc[stop.location.commune] || 0) + stop.personCount;
        return acc;
    }, {} as Record<string, number>);
    this.peopleByCommuneChart.data.labels = Object.keys(peopleByCommune);
    this.peopleByCommuneChart.data.datasets[0].data = Object.values(peopleByCommune);
    this.peopleByCommuneChart.update();
  }
  
  // Helper methods to pass to the template
  public getStatusClasses = getStatusClasses;
  public getStatusBadgeClasses = getStatusBadgeClasses;
}