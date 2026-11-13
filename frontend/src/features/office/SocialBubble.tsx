import { Billboard, Text } from '@react-three/drei'

const ignoreRaycast = () => {}

/** A quoted social line above a figure. Teal and quote-styled on purpose: this is local flavour,
 *  not a journal event, a task update or a provider/step badge. Non-raycastable so the figure
 *  underneath stays the click target. */
export function SocialBubble({ text, y = 2.42 }: { text: string; y?: number }) {
  return (
    <Billboard position={[0, y, 0]}>
      <mesh position={[0, 0, -0.012]} raycast={ignoreRaycast}>
        <planeGeometry args={[2.9, 0.66]} />
        <meshBasicMaterial color="#2f6f6a" transparent opacity={0.94} depthWrite={false} />
      </mesh>
      <mesh position={[-1.26, 0, -0.006]} raycast={ignoreRaycast}>
        <planeGeometry args={[0.055, 0.44]} />
        <meshBasicMaterial color="#9bd8cd" transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <Text
        fontSize={0.105}
        color="#f0f8f5"
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        maxWidth={2.45}
        lineHeight={1.25}
        raycast={ignoreRaycast}
      >
        {text}
      </Text>
    </Billboard>
  )
}
