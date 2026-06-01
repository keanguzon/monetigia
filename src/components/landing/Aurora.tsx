"use client";

import { useEffect, useRef } from "react";

interface AuroraProps {
  colorStops?: string[];
  amplitude?: number;
  blend?: number;
  speed?: number;
  className?: string;
}

export function Aurora({
  colorStops = ["#10b981", "#059669", "#064e3b"],
  amplitude = 0.8,
  blend = 0.35,
  speed = 0.5,
  className = "absolute inset-0 h-full w-full opacity-60 mix-blend-screen pointer-events-none",
}: AuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.offsetWidth || window.innerWidth || 800);
    let height = (canvas.height = canvas.offsetHeight || window.innerHeight || 600);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth || window.innerWidth || 800;
      height = canvas.height = canvas.offsetHeight || window.innerHeight || 600;
    };

    window.addEventListener("resize", handleResize);

    // Setup blobs for gradient animation
    const blobs = colorStops.map((color, index) => {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * speed * 2,
        vy: (Math.random() - 0.5) * speed * 2,
        radius: Math.min(width, height) * (0.4 + Math.random() * 0.3),
        color,
        angle: Math.random() * Math.PI * 2,
        speedAngle: (Math.random() - 0.5) * 0.01 * speed,
      };
    });

    const render = () => {
      // Clear with transparent background to allow seamless HSL theme blending
      ctx.clearRect(0, 0, width, height);

      // Save normal drawing operations
      ctx.save();
      ctx.globalCompositeOperation = "screen";

      blobs.forEach((blob) => {
        // Move blobs organically using a mixture of velocity and circular motion
        blob.angle += blob.speedAngle;
        const amplitudeFactor = amplitude * 5;
        
        blob.x += blob.vx + Math.sin(blob.angle) * amplitudeFactor * 0.1;
        blob.y += blob.vy + Math.cos(blob.angle) * amplitudeFactor * 0.1;

        // Bounce off walls
        if (blob.x < -blob.radius) blob.x = width + blob.radius;
        if (blob.x > width + blob.radius) blob.x = -blob.radius;
        if (blob.y < -blob.radius) blob.y = height + blob.radius;
        if (blob.y > height + blob.radius) blob.y = -blob.radius;

        // Draw radial gradient for each blob
        const gradient = ctx.createRadialGradient(
          blob.x,
          blob.y,
          0,
          blob.x,
          blob.y,
          blob.radius
        );

        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(0.2, blob.color);
        gradient.addColorStop(blend, `${blob.color}88`);
        gradient.addColorStop(0.7, `${blob.color}22`);
        gradient.addColorStop(1, "rgba(0,0,0,0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [colorStops, amplitude, blend, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ filter: "blur(40px)" }}
    />
  );
}
