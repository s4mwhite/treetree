import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { HandGesture, HandState } from '../types';

interface HandTrackerProps {
  onHandUpdate: (state: HandState) => void;
}

const HandTracker: React.FC<HandTrackerProps> = ({ onHandUpdate }) => {
  const webcamRef = useRef<Webcam>(null);
  const [loaded, setLoaded] = useState(false);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  // Fix: Initialize useRef with null
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    const loadLandmarker = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });
      setLoaded(true);
    };
    loadLandmarker();

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const detect = () => {
    if (
      webcamRef.current &&
      webcamRef.current.video &&
      webcamRef.current.video.readyState === 4 &&
      handLandmarkerRef.current
    ) {
      const video = webcamRef.current.video;
      const startTimeMs = performance.now();
      const results = handLandmarkerRef.current.detectForVideo(video, startTimeMs);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        // Analyze gesture
        // 1. Thumb tip (4) vs Index tip (8) distance for PINCH
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

        // 2. Average distance of finger tips to wrist (0) for OPEN vs FIST
        const wrist = landmarks[0];
        const tips = [8, 12, 16, 20].map(i => landmarks[i]);
        let avgDistToWrist = 0;
        tips.forEach(tip => {
            avgDistToWrist += Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
        });
        avgDistToWrist /= 4;

        let gesture = HandGesture.UNKNOWN;

        if (pinchDist < 0.05) {
            gesture = HandGesture.PINCH;
        } else if (avgDistToWrist < 0.25) { // Threshold for fist
            gesture = HandGesture.FIST;
        } else if (avgDistToWrist > 0.35) { // Threshold for open
            gesture = HandGesture.OPEN_PALM;
        }

        // Calculate normalized center position (-1 to 1) for camera control
        // X is inverted because webcam is mirrored usually
        const centerX = (wrist.x - 0.5) * -2; 
        const centerY = (wrist.y - 0.5) * -2;

        onHandUpdate({
            gesture,
            position: { x: centerX, y: centerY },
            isPresent: true
        });

      } else {
        onHandUpdate({
            gesture: HandGesture.UNKNOWN,
            position: { x: 0, y: 0 },
            isPresent: false
        });
      }
    }
    requestRef.current = requestAnimationFrame(detect);
  };

  useEffect(() => {
    if (loaded) {
      requestRef.current = requestAnimationFrame(detect);
    }
  }, [loaded]);

  return (
    <div className="fixed bottom-4 left-4 z-50 overflow-hidden rounded-xl border-2 border-amber-500/30 shadow-[0_0_15px_rgba(212,175,55,0.3)] bg-black/50 backdrop-blur-sm w-32 h-24 md:w-48 md:h-36">
      {!loaded && <div className="text-white text-xs p-2 text-center mt-8">Loading AI...</div>}
      <Webcam
        ref={webcamRef}
        mirrored
        className="w-full h-full object-cover opacity-80"
        videoConstraints={{ width: 320, height: 240, facingMode: "user" }}
      />
      <div className="absolute top-1 left-2 text-[10px] text-amber-300 font-mono tracking-widest uppercase">
        Vision Input
      </div>
    </div>
  );
};

export default HandTracker;
