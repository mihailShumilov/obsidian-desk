import { ImageResponse } from 'next/og';

// iOS pinned-tab + home-screen icon. Apple expects 180×180 PNG (Next will
// rasterise this JSX at request time, served at /apple-icon).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#05050A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 3 L28 9 L16 15 L4 9 Z" fill="#00F5D4" fillOpacity="0.85" />
          <path d="M4 9 L16 15 L16 29 L4 23 Z" fill="#12121C" stroke="#1E1E2C" strokeWidth="0.5" />
          <path d="M28 9 L16 15 L16 29 L28 23 Z" fill="#1E1E2C" stroke="#2A2A3C" strokeWidth="0.5" />
        </svg>
      </div>
    ),
    size,
  );
}
