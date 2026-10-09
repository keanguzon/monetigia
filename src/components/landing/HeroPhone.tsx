import Image from "next/image";

export function HeroPhone() {
  return (
    <figure className="relative mx-auto w-full max-w-[620px]">
      <Image
        src="/landing/phone-goals-light.png"
        alt="Sample Monetigia Goals screen shown on a phone held in one hand"
        width={1448}
        height={1086}
        sizes="(min-width: 1024px) 45vw, 90vw"
        priority
        className="h-auto w-full dark:hidden"
      />
      <Image
        src="/landing/phone-goals-dark.png"
        alt="Sample Monetigia Goals screen in dark mode shown on a phone held in one hand"
        width={1448}
        height={1086}
        sizes="(min-width: 1024px) 45vw, 90vw"
        priority
        className="hidden h-auto w-full dark:block"
      />
      <figcaption className="mt-2 text-right text-xs text-muted-foreground">Sample screen</figcaption>
    </figure>
  );
}
