import { CampusBuildings } from './CampusBuildings'
import { CampusGround } from './CampusGround'
import { CampusNature } from './CampusNature'
import { CampusProps } from './CampusProps'

/** The bounded outdoor campus. Kept mounted so switching camera modes never rebuilds
 *  geometry, and culled as a group when Office View needs the interior budget. */
export function Campus({ visible }: { visible: boolean }) {
  return (
    <group visible={visible}>
      <CampusGround />
      <CampusBuildings />
      <CampusNature />
      <CampusProps />
    </group>
  )
}
