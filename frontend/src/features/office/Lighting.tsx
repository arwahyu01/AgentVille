/** Layered lighting, cheapest-first:
 *  · daylight — a warm hemisphere wash plus one shadow-casting sun through the glazing;
 *  · bounce — a cold fill from the opposite side so nothing goes flat black;
 *  · practicals — three no-shadow point lights over the lobby, pantry and meeting table, which is
 *    where a pendant would actually pool light. Desk lamps and LED panels stay emissive only, since
 *    every extra real light re-prices every material in the scene.
 *  The sun's orthographic shadow volume is fitted to the office plate for Office View and widened
 *  for the campus. A 1k map is the honest budget here: it is what the frame can afford. */
export function Lighting({ quality, extent = 15 }: { quality: 'high' | 'lean'; extent?: number }) {
  const map = quality === 'high' ? 1024 : 512
  const wide = extent > 20
  return (
    <>
      {/* Daylight is deliberately top-heavy: a soft sky wash, one warm sun for direction and a
       * weak cool fill from the opposite side. The previous 0.82/0.2/2.45 stack flattened every
       * material into the same off-white; these values keep the pale palette but restore shading. */}
      <hemisphereLight args={['#e7f1fb', '#b9ab93', wide ? 0.58 : 0.46]} />
      <ambientLight intensity={wide ? 0.16 : 0.11} color="#fff4e6" />
      <directionalLight
        position={[16, 21, 13]}
        intensity={wide ? 2.0 : 1.75}
        color="#ffe9c9"
        castShadow
        shadow-mapSize-width={map}
        shadow-mapSize-height={map}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent * 0.82}
        shadow-camera-bottom={-extent * 0.82}
        shadow-camera-near={0.5}
        shadow-camera-far={wide ? 180 : 48}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-14, 9, -12]} intensity={wide ? 0.3 : 0.26} color="#d7e6f3" />
      {PRACTICALS.map(([x, y, z, i]) => (
        <pointLight key={`${x}-${z}`} position={[x, y, z]} color="#ffdcae" intensity={i} distance={6.5} decay={2} />
      ))}
      {/* Cool accent inside the restricted zone: it reads as equipment light, not decoration. */}
      <pointLight position={[-10.8, 2.3, -5.0]} color="#a9d9dc" intensity={1.1} distance={6} decay={2} />
    </>
  )
}

/** Pendant heights: the shade geometry lives in the fitout, the light source sits just under it. */
const PRACTICALS: [number, number, number, number][] = [
  [-10.2, 2.05, 3.7, 5.5],
  [10.3, 2.05, 4.9, 4.5],
  [6.2, 2.1, 5.6, 5.0],
]

/** Sky colour and fog. Office View keeps the old interior haze; campus views need to see the
 *  hills and the boundary treeline without the office dissolving into fog. */
export const SKY = { color: '#eaf0f4', near: 46, far: 105 }
export const SKY_CAMPUS = { color: '#dfeaf0', near: 120, far: 300 }
export const SKY_EXPLORE = { color: '#e6eef2', near: 80, far: 240 }
