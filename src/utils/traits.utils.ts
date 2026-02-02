export function transformTrait(jsonArray: Trait[]): Attribute[] {
  const groupedObjects: Record<string, Trait[]> = {};

  jsonArray.forEach(obj => {
    const { traitType } = obj;
    if (!groupedObjects[traitType]) {
      groupedObjects[traitType] = [];
    }
    groupedObjects[traitType].push(obj);
  });

  const target = Object.values(groupedObjects).map(group => {
    return { attributes: group };
  });

  return target;
}


export interface Trait {
  traitType: string;
  value: string | number;
}

export interface Attribute {
  attributes: Trait[];
}

export interface TransformedData {
  attributes: Attribute[];
}
