import Image from "next/image";

export function HeroPhone() {
  return (
    <figure className="relative mx-auto aspect-[1063/1086] w-full max-w-[460px] overflow-hidden">
      <Image
        src="/landing/phone-goals-light.png"
        alt="Sample Monetigia Goals screen shown on a phone held in one hand"
        width={1448}
        height={1086}
        sizes="(min-width: 1024px) 45vw, 90vw"
        priority
        className="absolute -left-[36.22%] top-0 h-auto w-[136.22%] max-w-none dark:hidden"
      />
      <Image
        src="/landing/phone-goals-dark.png"
        alt="Sample Monetigia Goals screen in dark mode shown on a phone held in one hand"
        width={1448}
        height={1086}
        sizes="(min-width: 1024px) 45vw, 90vw"
        priority
        className="absolute -left-[36.22%] top-0 hidden h-auto w-[136.22%] max-w-none dark:block"
        style={{ transform: "translate(0.76%, 0.83%)" }}
      />
    </figure>
  );
}
