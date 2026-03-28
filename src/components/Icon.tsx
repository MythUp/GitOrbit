// Purpose: Provide lightweight inline SVG icons used across launcher navigation and profile entries.
interface IconProps {
  name: "home" | "compass" | "plus" | "github" | "search" | "user";
  className?: string;
}

export default function Icon({ name, className }: IconProps) {
  if (name === "home") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="currentColor" />
      </svg>
    );
  }

  if (name === "compass") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 6.7 14.1 12 12 11.2 9.9 12Z" fill="currentColor" />
        <path d="M12 17.3 9.9 12 12 12.8 14.1 12Z" fill="currentColor" opacity="0.45" />
        <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M14.8 14.8 20 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M8 10.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
        <path d="M10.5 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      </svg>
    );
  }

  if (name === "user") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2c-3.5 0-7 1.8-7 4v2h14v-2c0-2.2-3.5-4-7-4Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.4c-3.3.7-4-1.4-4-1.4-.5-1.4-1.2-1.7-1.2-1.7-1-.7.1-.7.1-.7 1 .1 1.7 1 1.7 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.7-1.4-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a10.8 10.8 0 0 1 5.8 0C17.1 5 18 5.3 18 5.3c.7 1.6.3 2.8.2 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.3.8 1 .8 2v3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"
        fill="currentColor"
      />
    </svg>
  );
}