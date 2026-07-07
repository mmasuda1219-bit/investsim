import type { InvestorLogic } from '@/types'
import buffett from './buffett'
import soros from './soros'
import lynch from './lynch'
import graham from './graham'
import dalio from './dalio'

// Adding a new investor: create lib/investors/{name}.ts implementing InvestorLogic,
// then add it to this array. The UI auto-discovers from this list.
const investors: InvestorLogic[] = [buffett, soros, lynch, graham, dalio]

export default investors
export { buffett, soros, lynch, graham, dalio }
