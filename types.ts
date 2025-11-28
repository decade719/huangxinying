export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface VisionResult {
  landmarks: HandLandmark[][];
}
