# worker-rpc

Transparent typed client-worker interaction via effects and `effector/babel-plugin`

**common**
```typescript
import {createDomain} from 'effector'
export const api = createDomain()

export const exampleEffect = api.effect()
```

**worker**:

```typescript
import {exampleEffect} from './common'

exampleEffect.use(message => {
  console.log('message from client: ', message)
  return 'hello client'
})
```

**client**:

```typescript
import {exampleEffect} from './common'

await exampleEffect('hello worker')
// => message from client: hello worker
// => hello client
```
