import { FormatOptions, prettyPrintJson } from 'pretty-print-json';

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

export const htmlTemplate = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%title%></title>
<style  type="text/css">
.json-container {
  font-family: menlo, consolas, monospace;
  font-style: normal;
  font-weight: 400;
  line-height: 1.4em;
  font-size: 0.85rem;
}
ol.json-lines {
  white-space: normal;
  padding-inline-start: 0.5em;
  margin: 0;
}
ol.json-lines >li {
  white-space: pre;
  text-indent: 0.7em;
  line-height: 1.32em;
  padding: 0;
}
ol.json-lines >li::marker {
  font-family: system-ui, sans-serif;
  font-weight: normal;
}
.json-pretty {
  padding-left: 30px;
  padding-right: 30px;
}
.json-string {
  color: #000;
}
.json-key {
  color: #000080;
  font-weight: 600;
}
.json-boolean {
  color: #007300;
}
.json-number {
  color: #00f;
}
@media only screen and (min-width: 250px) and (max-width: 1024px) {}
</style>
</head>
<body>
  <%body%>
</body>
</html>
`;

export interface TFillHtmlTemplateArgs { title?: string, body?: string }

export const fillHtmlTemplate = (args: TFillHtmlTemplateArgs): string => {
  let text = htmlTemplate;
  ['title', 'body'].forEach((n) => {
    text = text.replace(`<%${n}%>`, args[n as keyof TFillHtmlTemplateArgs] || '');
  });
  return text;
};

export const jsonToHtml = (json: any): string => {
  const prettyPrintJsonOptions: FormatOptions = { linkUrls: true, indent: 2 };
  return `<pre>${prettyPrintJson.toHtml(json, prettyPrintJsonOptions)}\n</pre>`;
};
