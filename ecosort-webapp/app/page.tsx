
'use client';
import Image from "next/image";
import WebcamWrapper from "./components/WebcamWrapper";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.push("/test-webcam.html");
  }, []);
  return (
    <div className="w-full max-w-2xl mx-auto my-8">

    </div>
  );
}
