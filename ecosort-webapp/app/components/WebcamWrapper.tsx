'use client';

import dynamic from 'next/dynamic';

// Dynamically import the WebcamCapture component with no SSR
// This is necessary because the component uses browser APIs
const WebcamCapture = dynamic(
  () => import('./WebcamCapture'),
  { ssr: false }
);

export default function WebcamWrapper() {
  return <WebcamCapture />;
}
