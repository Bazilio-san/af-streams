export interface ITraverseNode {
  key: string | undefined,
  val: any,
  parents: string[],
  path: string[],
  isLeaf: boolean,
  isRoot: boolean,
  isPrimitive: boolean,
  isCyclic: boolean,
}

export const traverse = (
  val: any,
  callback: (_args: ITraverseNode) => void = () => undefined,
  parents: string[] = [],
  key: string | undefined = undefined,
  hash: WeakSet<any> = new WeakSet(),
) => {
  const isRoot = key === undefined;
  const path = isRoot ? [] : [...parents, key];
  let isPrimitive = false;
  const ret = (isLeaf = true, isCyclic = false) => {
    callback({
      key, val, parents, path, isLeaf, isPrimitive, isRoot, isCyclic,
    });
  };

  if (hash.has(val)) {
    // cyclic reference
    return ret(true, true);
  }

  if (Object(val) !== val) {
    // primitives
    isPrimitive = true;
    return ret();
  }
  hash.add(val);
  if (val instanceof Set || val instanceof Date || val instanceof RegExp || val instanceof Function) {
    return ret();
  }
  if (val instanceof Map) {
    ret(false);
    [...val.entries()].forEach(([key2, val2]) => traverse(val2, callback, path, key2, hash));
    return;
  }
  ret(false);
  Object.entries(val).forEach(([key2, val2]) => {
    traverse(val2, callback, path, key2, hash);
  });
};

export const flattenObjectPrimitiveLeafs = (obj: any, options: { keysAsPath?: boolean, noOverrideKeys?: boolean } = {}) => {
  const { keysAsPath = true, noOverrideKeys = false } = options;
  const leafs: { [key: string]: string | number | boolean | null } = {};
  traverse(obj, (data) => {
    if (data.isLeaf && data.isPrimitive) {
      const key = keysAsPath ? data.path.join('.') : data.key;
      if (key && (!noOverrideKeys || leafs[key] === undefined)) {
        leafs[key] = data.val;
      }
    }
  });
  return leafs;
};

/**
 * Замена мест подстановки {place_name} на значения одноименных свойств из obj
 */
export const fillSubjectTemplate = (template: string, obj: any): string => {
  const flattened = flattenObjectPrimitiveLeafs(obj);
  template = template.replace(/{([\w]+)}/g, (place: any, placeName: any) => {
    const val = flattened[String(placeName)];
    return val === undefined ? place : val;
  });
  return template;
};

export const removeHTML = (s: string) => String(s).replace(/<\/?[^>]+>/ig, '');
