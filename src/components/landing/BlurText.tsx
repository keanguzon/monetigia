"use client";

import { motion } from "framer-motion";

interface BlurTextProps {
  text: string;
  delay?: number;
  duration?: number;
  className?: string;
  staggerDelay?: number;
}

export function BlurText({
  text,
  delay = 0,
  duration = 0.8,
  className = "",
  staggerDelay = 0.08,
}: BlurTextProps) {
  const words = text.split(" ");

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: delay,
      },
    },
  };

  const wordVariants = {
    hidden: {
      opacity: 0,
      y: 20,
      filter: "blur(12px)",
      scale: 0.9,
    },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      scale: 1,
      transition: {
        duration: duration,
        ease: [0.2, 0.65, 0.3, 0.9] as const, // springy cubic bezier
      },
    },
  };

  return (
    <motion.h1
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {words.map((word, index) => (
        <motion.span
          key={index}
          variants={wordVariants}
          className="inline-block mr-[0.25em] whitespace-nowrap"
        >
          {word}
        </motion.span>
      ))}
    </motion.h1>
  );
}
