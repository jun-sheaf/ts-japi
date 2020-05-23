import { DataDocument } from "../interfaces/document.interface";
import { SerializerOptions } from "../interfaces/serializer.interface";
import ResourceIdentifier from "../models/resource-identifier.model";
import Resource from "../models/resource.model";
import { Dictionary, SingleOrArray } from "../types/global.types";
import merge from "../utils/merge";
import Metaizer from "./metaizer";
import Relator from "./relator";
import { getArray } from "../utils/get-array";
import Relationship from "../models/relationship.model";

/**
 * The {@linkcode Serializer} class is the main class used to serializer data
 * (you can use the {@linkcode ErrorSerializer} class to serialize errors).
 *
 * Example:
 * ```typescript
 * [[include:serializer.example.ts]]
 * ```
 */
export default class Serializer<PrimaryType extends Dictionary<any> = any> {
 /**
  * Default options. Can be edited to change default options globally.
  */
 public static defaultOptions = {
  idKey: "id",
  version: "1.0",
  onlyIdentifier: false,
  nullData: false,
  asIncluded: false,
  onlyRelationship: false,
  depth: 0,
  linkers: {},
  metaizers: {},
 };

 /**
  * The name to use for the type.
  */
 public collectionName: string;

 /**
  * The set of options for the serializer.
  */
 public options: SerializerOptions<PrimaryType>;

 /**
  * Creates a {@linkcode Serializer}.
  *
  * @param collectionName The name of the collection of objects.
  * @param options Options for the serializer.
  */
 public constructor(collectionName: string, options: Partial<SerializerOptions<PrimaryType>> = {}) {
  // Setting default options.
  this.options = merge({}, Serializer.defaultOptions, options);

  // Setting type name.
  this.collectionName = collectionName;
 }

 /** @internal Generates a `ResourceIdentifier`. */
 public createIdentifier(data: PrimaryType, options?: SerializerOptions<PrimaryType>) {
  // Get options
  if (!options) options = this.options;

  return new ResourceIdentifier(
   { type: this.collectionName, id: data[options.idKey] },
   options.metaizers.resource ? options.metaizers.resource.metaize(data) : undefined
  );
 }

 /** @internal Generates a `Resource`. */
 public async createResource(data: PrimaryType, options?: SerializerOptions<PrimaryType>) {
  // Get options
  if (!options) options = this.options;

  // Get ID before projections.
  const id = data[options.idKey];

  // Get attributes
  const attributes: Partial<PrimaryType> = {};
  if (options.projection) {
   for (const [key, value] of Object.entries(data) as any[]) {
    if (options.projection[key]) attributes[key] = value;
   }
  } else {
   for (const [key, value] of Object.entries(data) as any[]) {
    attributes[key] = value;
   }
  }

  // Handle relationships
  const relationships: Record<string, Relationship> = {};
  if (options.relators) {
   const relators = getArray(options.relators);
   await Promise.all(
    relators.map((relator) => {
     const serializer = relator.getRelatedSerializer();
     if (serializer) {
      return relator
       .getRelationship(data)
       .then((rship) => (relationships[serializer.collectionName] = rship));
     } else return;
    })
   );
  }

  // Delete the ID field.
  delete attributes[options.idKey];

  return new Resource<PrimaryType>(
   {
    type: this.collectionName,
    id,
    attributes,
    relationships: Object.keys(relationships).length > 0 ? relationships : undefined,
    links: options.linkers.resource ? { self: options.linkers.resource.link(data) } : undefined,
   },
   options.metaizers.resource ? options.metaizers.resource.metaize(data) : undefined
  );
 }

 /**
  * The actual serialization function.
  *
  * @param data Data to serialize.
  * @param options Options to use at runtime.
  */
 public async serialize(
  data?: SingleOrArray<PrimaryType>,
  options: Partial<SerializerOptions<PrimaryType>> = {}
 ) {
  // Merge options.
  const o = merge({}, this.options, options);

  // Validate options.
  if (o.depth < 0) {
   throw new RangeError(`"depth" must be greater than or equal to 0`);
  }
  if (data === undefined && !(o.metaizers.document instanceof Metaizer)) {
   throw new TypeError(`Data or a "document" metaizer must be given`);
  }

  // Setting up locals
  const included = new Map<string, Resource>();
  const primary = new Map<string, Resource | ResourceIdentifier>();

  // Construct initial document and included data
  const document: DataDocument<PrimaryType> = {};

  // Document versioning
  if (o.version) {
   document.jsonapi = { ...document.jsonapi, version: o.version };
  }

  if (o.metaizers.jsonapi) {
   document.jsonapi = { ...document.jsonapi, meta: o.metaizers.jsonapi.metaize() };
  }

  // Document meta
  if (o.metaizers.document) {
   document.meta = o.metaizers.document.metaize(data);
  }

  // Document links
  if (o.linkers.document) {
   document.links = { ...document.links, self: o.linkers.document.link(data) };
  }

  // Constructing utility functions
  const getIdentifiers = (data: PrimaryType[]) => {
   return data.map((datum) => this.createIdentifier(datum, o));
  };
  const getResources = (data: PrimaryType[]) => {
   return Promise.all(data.map((datum) => this.createResource(datum, o)));
  };

  // Check if data is null or undefined
  if (o.nullData || !data) {
   document.data = null;
   return document;
  }

  // Normalize data
  let originallySingular = false;
  if (!Array.isArray(data)) {
   originallySingular = true;
   data = [data];
  }

  // Data-based document links
  if (o.linkers.paginator) {
   const pagination = o.linkers.paginator.paginate(data);
   if (pagination) {
    document.links = { ...document.links, ...o.linkers.paginator.paginate(data) };
   }
  }

  switch (true) {
   case o.onlyIdentifier: {
    for (const identifier of getIdentifiers(data)) {
     primary.set(identifier.getKey(), identifier);
    }
    break;
   }
   case !!o.onlyRelationship: {
    // Validate options.
    if (o.relators === undefined) {
     throw new TypeError(`"relators" must be defined when using "onlyRelationship"`);
    }
    if (!originallySingular) {
     throw new TypeError(`Cannot serialize multiple primary datum using "onlyRelationship"`);
    }

    const relator = getArray(o.relators).find(
     (relator) => !!(relator.getRelatedSerializer()?.collectionName === o.onlyRelationship)
    );
    if (relator === undefined) {
     throw new TypeError(
      `"onlyRelationship" is not the name of any collection name among the relators listed in "relators"`
     );
    }

    // Reset singularity option
    originallySingular = false;

    // Get relationship
    const relationship = await relator.getRelationship(data[0]);
    if (relationship.links) {
     document.links = relationship.links;
    }
    if (relationship.meta) {
     document.meta = relationship.meta;
    }
    if (relationship.data) {
     if (!Array.isArray(relationship.data)) {
      originallySingular = true;
      relationship.data = [relationship.data];
     }
     for (const identifier of relationship.data) {
      primary.set(identifier.getKey(), identifier);
     }
     await recurseResources(data);
    }
    break;
   }
   default: {
    const resources = await getResources(data);
    if (o.asIncluded) {
     for (const resource of resources) {
      included.set(resource.getKey(), resource);
     }
     for (const identifier of getIdentifiers(data)) {
      primary.set(identifier.getKey(), identifier);
     }
    } else {
     for (const resource of resources) {
      primary.set(resource.getKey(), resource);
     }
    }
    await recurseResources(data);
   }
  }

  if (included.size > 0) {
   document.included = [...included.values()];
  }
  document.data =
   primary.size > 0
    ? originallySingular
      ? [...primary.values()][0]
      : [...primary.values()]
    : originallySingular
    ? null
    : [];

  return document;

  async function recurseResources(data: PrimaryType[]) {
   if (o.depth <= 0 || !o.relators) return;
   const queue: [Array<Dictionary<any>>, Array<Relator<any>>][] = [[data, getArray(o.relators)]];
   let depth = o.depth;
   while (queue.length > 0 && depth-- > 0) {
    for (let i = 0, len = queue.length; i < len; i++) {
     const [data, relators] = queue[i];
     for (const relator of relators) {
      const serializer = relator.getRelatedSerializer();
      if (serializer === undefined) continue;
      const relatedData = (await Promise.all(data.map(relator.getRelatedData))).flat();
      if (relatedData.length > 0) {
       const newData = [];
       for (const datum of relatedData) {
        const resource = await serializer.createResource(datum);
        const key = resource.getKey();
        if (
         !included.has(key) &&
         (!primary.has(key) || primary.get(key) instanceof ResourceIdentifier)
        ) {
         newData.push(datum);
         included.set(key, resource);
        }
       }
       if (newData.length > 0 && serializer.options.relators) {
        queue.push([newData, getArray(serializer.options.relators)]);
       }
      }
     }
    }
   }
  }
 }
}
