import { Injectable } from '@angular/core';
import { BusStop, Camera } from '../models/bus-stop.model';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

// This type represents the structure of the data from the 'paradero_mediciones' table
interface ParaderoMedicion {
  id: number;
  person_count: number;
  status: string; // Original status from DB, we'll override it based on count
  sensor1_distance: number;
  sensor2_distance: number;
  location: { lat?: number; lng?: number } | null;
  direccion: string | null; // New field from Supabase
  timestamp: string;
  recommendation: string | null;
}

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

@Injectable({
  providedIn: 'root',
})
export class BusStopService {
  private supabaseUrl = 'https://izrwdgnhpqdfmwhtrylt.supabase.co';
  private supabaseKey = 'sb_publishable_1cdquiCf2Vp2YA3MATaOOQ_l6Kwt0V5';
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  constructor() {
    this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
  }

  async getBusStopDensity(): Promise<BusStop[]> {
    const { data, error } = await this.supabase
      .from('paradero_mediciones')
      .select('*')
      .order('id');

    if (error) {
      console.error('Error fetching from Supabase:', error);
      return []; // Return empty array on error to prevent app crash
    }

    if (!data) {
      return [];
    }

    // Map Supabase data to the application's BusStop model
    return (data as ParaderoMedicion[]).map(this.mapParaderoToBusStop);
  }

  subscribeToBusStopChanges(
    onInsert: (stop: BusStop) => void,
    onUpdate: (stop: BusStop) => void,
    onDelete: (stopId: string) => void
  ) {
    if (this.channel) return;

    this.channel = this.supabase
      .channel('paradero_mediciones_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'paradero_mediciones' },
        (payload) => onInsert(this.mapParaderoToBusStop(payload.new as ParaderoMedicion))
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'paradero_mediciones' },
        (payload) => onUpdate(this.mapParaderoToBusStop(payload.new as ParaderoMedicion))
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'paradero_mediciones' },
        (payload) => onDelete(`stop-${(payload.old as any).id}`)
      )
      .subscribe();
  }

  unsubscribeFromChanges() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  private mapParaderoToBusStop(typedItem: ParaderoMedicion): BusStop {
    // 1. Get location directly from the parsed JSONB object from Supabase
    const lat = typedItem.location?.lat ?? -33.45;
    const lng = typedItem.location?.lng ?? -70.6;

    // 2. Determine status based on person count for UI consistency
    const personCount = typedItem.person_count;
    let status: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (personCount > 75) status = 'critical';
    else if (personCount > 50) status = 'high';
    else if (personCount > 20) status = 'medium';

    // 3. Generate mock data for missing fields to enrich the UI
    const mockData = MOCK_ADDRESSES[ (typedItem.id -1) % MOCK_ADDRESSES.length];
    const avgWaitTimeMinutes = Math.max(1, personCount * 0.4 + (Math.random() * 4 - 2));
    const cameraCount = 1 + (typedItem.id % 3); // 1 to 3 cameras for variety
    const cameras: Camera[] = Array.from({ length: cameraCount }, (_, i) => ({
      cameraId: `cam-${typedItem.id}-${i + 1}`,
      status: Math.random() > 0.2 ? 'online' : 'offline',
      url: `https://picsum.photos/640/480?random=${typedItem.id * 10 + i}`
    }));

    return {
      stopId: `stop-${typedItem.id}`,
      timestamp: typedItem.timestamp,
      location: {
        // Use the real address from Supabase, fallback to mock, and use mock commune
        address: typedItem.direccion || mockData.address,
        commune: mockData.commune,
        lat: lat,
        lng: lng,
      },
      status: status,
      personCount: personCount,
      avgWaitTimeMinutes: avgWaitTimeMinutes,
      cameras: cameras,
    };
  }
}