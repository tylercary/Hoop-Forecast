import { useState } from 'react';
import { getSportsbookInfo, textColorFor } from '../utils/sportsbookLogos';

const initials = (name) => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

/**
 * Column header for a sportsbook in the odds tables: its icon and name on the
 * brand color, the same size for every book so the columns line up.
 */
function SportsbookHeader({ bookmaker, className = '' }) {
  const [iconFailed, setIconFailed] = useState(false);
  const info = getSportsbookInfo(bookmaker);
  const bg = info.bannerBg || '#1e293b';
  const color = textColorFor(bg);

  return (
    <div
      className={`flex h-12 items-center gap-2 rounded-lg border border-slate-700/60 px-2.5 ${className}`}
      style={{ backgroundColor: bg, color }}
      title={info.displayName}
    >
      {info.icon && !iconFailed ? (
        <img
          src={info.icon}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 flex-shrink-0 rounded-md object-contain"
          onError={() => setIconFailed(true)}
        />
      ) : (
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
          style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
        >
          {initials(info.displayName)}
        </span>
      )}
      <span className="truncate text-[11px] font-semibold tracking-wide">{info.displayName}</span>
    </div>
  );
}

export default SportsbookHeader;
