'use client';

// THESE ARE JUST FOR TESTING, NOT USING THEM, WE ARE USING THE HTML FILES IN PUBLIC FOLDER
import { useRef, useState, useEffect, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

export default function WebcamCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Capture image from webcam and send it to the Flask server
  const captureAndSendImage = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsCapturing(true);
    setResult(null);
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas image to base64-encoded JPEG
    const imageData = canvas.toDataURL('image/jpeg');
    console.log('Image captured');

    // Send the captured image to the server via Socket.IO
    if (socket && socket.connected) {
      console.log('Sending image to server via Socket.IO');
      socket.emit('image_captured', imageData);
    } else {
      console.error('Socket not connected, cannot send image');
      setError('Socket not connected, cannot send image');
      setIsCapturing(false);
    }
  }, [socket]);

  // Initialize socket connection
  useEffect(() => {
    const socketInstance = io();

    socketInstance.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    // When a capture trigger is received, capture and send the image.
    socketInstance.on('start_capture', () => {
      console.log('Received start_capture event');
      captureAndSendImage();
    });

    // When processing result is received
    socketInstance.on('processing_result', (data) => {
      console.log('Received processing result:', data);
      setResult(data);
      setIsCapturing(false);
    });

    // Handle errors
    socketInstance.on('error', (err) => {
      console.error('Socket error:', err);
      setError(err.message || 'An error occurred');
      setIsCapturing(false);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [captureAndSendImage]);

  // Initialize webcam access
  useEffect(() => {
    const initWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Error accessing webcam:', err);
        setError('Could not access webcam');
      }
    };

    initWebcam();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Manual capture button handler
  const handleCapture = () => {
    captureAndSendImage();
  };

  // Trigger capture via API
  const triggerCaptureViaAPI = async () => {
    try {
      const response = await fetch('/api/trigger-capture');
      const data = await response.json();
      console.log('API trigger response:', data);
    } catch (err) {
      console.error('Error triggering capture via API:', err);
    }
  };

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Garbage Classification System</h1>

      <div className="mb-4 p-2 border rounded bg-gray-100">
        <p>Socket Status: {isConnected ? 
          <span className="text-green-500 font-bold">Connected</span> : 
          <span className="text-red-500 font-bold">Disconnected</span>}
        </p>
      </div>

      <div className="relative mb-4">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="rounded-lg shadow-lg"
          style={{ width: '640px', height: '480px', backgroundColor: '#000' }}
        />

        {isCapturing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
            <div className="text-white text-xl">Processing...</div>
          </div>
        )}
      </div>

      {/* Hidden canvas for capturing images */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className="flex space-x-4 mb-4">
        <button 
          onClick={handleCapture}
          disabled={isCapturing || !isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Capture Image
        </button>

        <button 
          onClick={triggerCaptureViaAPI}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Trigger via API
        </button>
      </div>

      {error && (
        <div className="mt-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 border rounded bg-gray-50 w-full max-w-lg">
          <h2 className="text-xl font-bold mb-2">Classification Result</h2>
          <pre className="bg-gray-100 p-2 rounded overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>

          {result.data && result.data.classification && (
            <div className="mt-4 text-center">
              <div className="text-2xl font-bold">
                Classification: {result.data.classification}
              </div>
              <div className={`mt-2 inline-block px-4 py-2 rounded-full ${
                result.data.classification === 'recycle' ? 'bg-green-500 text-white' :
                result.data.classification === 'waste' ? 'bg-red-500 text-white' :
                'bg-yellow-500 text-black'
              }`}>
                {result.data.classification === 'recycle' ? 'Recyclable ♻️' :
                 result.data.classification === 'waste' ? 'Waste 🗑️' :
                 'Mixed 🔄'}
              </div>
            </div>
          )}

          {result.data && result.data.image && (
            <div className="mt-4">
              <p>Image saved: {result.data.image.filename}</p>
              <p>Timestamp: {result.data.image.timestamp}</p>
              <a 
                href={`/api/latest-image`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                View captured image
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
