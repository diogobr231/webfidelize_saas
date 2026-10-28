import Link from "next/link";

export function Brand({
  href = "/",
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      className={`brand ${className}`}
      href={href}
      aria-label="Web Fidelize — início"
    >
      <span className="brand-logo" aria-hidden="true">
        <img
          src="/webfidelize-logo.png"
          alt=""
          width={1600}
          height={533}
          decoding="async"
        />
      </span>
    </Link>
  );
}
