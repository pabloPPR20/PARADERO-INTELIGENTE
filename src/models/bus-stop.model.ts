export interface BusStop {
  stopId: string;
  timestamp: string;
  location: Location;
  status: 'low' | 'medium' | 'high' | 'critical';
  personCount: number;
  avgWaitTimeMinutes: number;
  cameras: Camera[];
}

export interface Location {
  address: string;
  commune: string;
  lat: number;
  lng: number;
}

export interface Camera {
  cameraId: string;
  status: 'online' | 'offline';
  url: string;
}