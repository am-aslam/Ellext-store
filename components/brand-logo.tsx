import Image from 'next/image';

export function BrandLogo() {
  return <Image
    src="/ellext-logo.png"
    alt="Ellext Clothing & Jewels"
    width={1981}
    height={793}
    className="brand-image"
    priority
  />;
}
