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
      <svg
        className="brand-mark"
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 7.5 10 21 15 10l3 7 6-10"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="7" r="2" fill="currentColor" />
      </svg>
      <span className="brand-word">
        web<span>fidelize</span>
        <span className="brand-period">.</span>
      </span>
    </Link>
  );
}
