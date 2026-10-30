import type { Plugin } from 'esbuild';

// Operation tests keep real presentation with reduced motion; motion lifecycle has its own tests.
export const OPERATION_MOTION_NATIVE = `
  class StaticValue {
    constructor(value){this.value=value}
    setValue(value){this.value=value}
    interpolate(){return this}
  }
  const scalar=value=>value instanceof StaticValue?value:new StaticValue(value);
  export const Animated={View:'View',ScrollView:'ScrollView',Value:StaticValue,
    add:scalar,multiply:scalar,modulo:scalar,event:()=>()=>{}};
  export const Easing={linear:x=>x,cubic:x=>x,ease:x=>x,out:x=>x,inOut:x=>x};
`;

export const OPERATION_MOTION_PREFERENCE = `
  import {Platform} from 'react-native';
  export const nativeDriver=Platform.OS!=='web';
  export const useAmbientMotion=()=>({reduced:true,animate:false});
`;

export const operationMotionPreferencePlugin: Plugin = {
  name: 'static-operation-motion',
  setup(builder) {
    builder.onResolve({ filter: /use-ambient-motion$/ }, () => ({ path: 'preference', namespace: 'static-operation-motion' }));
    builder.onLoad({ filter: /.*/, namespace: 'static-operation-motion' }, () => ({ contents: OPERATION_MOTION_PREFERENCE }));
  },
};
