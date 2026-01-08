import { Vector3 } from 'three';

export enum AppMode {
  TREE = 'TREE',
  SCATTER = 'SCATTER',
  ZOOM = 'ZOOM',
}

export enum HandGesture {
  UNKNOWN = 'UNKNOWN',
  FIST = 'FIST',
  OPEN_PALM = 'OPEN_PALM',
  PINCH = 'PINCH',
}

export interface ParticleData {
  id: string;
  initialPos: Vector3; // The position in the tree
  scatterPos: Vector3; // The position when scattered
  color: string;
  type: 'SPHERE' | 'CUBE' | 'CANDY';
  scale: number;
}

export interface PhotoData {
  id: string;
  url: string;
  aspectRatio: number;
  initialPos: Vector3;
  scatterPos: Vector3;
}

export interface HandState {
  gesture: HandGesture;
  position: { x: number; y: number }; // Normalized -1 to 1
  isPresent: boolean;
}