import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// `findBy*` and `waitFor` give up after 1 s by default. The App tests render the whole page and
// resolve several mocked requests in a row, so on a busy machine (dev servers and a browser
// running beside the tests) 1 s was occasionally not enough and one test failed once without a
// code change. A longer ceiling only costs time when something is actually wrong.
configure({ asyncUtilTimeout: 4000 })
