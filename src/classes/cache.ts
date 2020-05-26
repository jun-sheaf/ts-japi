import { SerializerOptions } from "../interfaces/serializer.interface";
import { DataDocument } from "../interfaces/json:api.interface";
import { SingleOrArray, nullish } from "../types/global.types";
import { CacheOptions } from "../interfaces/cache.interface";

export default class Cache<PrimaryType> {
 /**
  * The default max for document storage
  */
 public static defaultLimit = 10;

 /** @internal The storage for the cache */
 private storage: Array<
  [
   SingleOrArray<PrimaryType> | nullish,
   Partial<SerializerOptions<PrimaryType>> | undefined,
   DataDocument<PrimaryType>
  ]
 > = [];

 /**
  * The maximum amount of documents that can be storage before erasure.
  */
 private limit: number = Cache.defaultLimit;

 /**
  * The method to use in determining data equality
  */
 private resolver: (
  storedData: PrimaryType | PrimaryType[] | null | undefined,
  newData: PrimaryType | PrimaryType[] | null | undefined
 ) => boolean = Object.is;

 /**
  * Creates a {@linkcode Cache}
  *
  * @param limit The maximum amount of documents that can be stored before erasure.
  */
 public constructor(options: Partial<CacheOptions<PrimaryType>> = {}) {
  if (options.limit) this.limit = options.limit;
  if (options.resolver) this.resolver = options.resolver;
 }

 /** @internal Gets a document in the cache */
 public get(
  data: SingleOrArray<PrimaryType> | nullish,
  options?: Partial<SerializerOptions<PrimaryType>>
 ) {
  const document = this.storage.find(
   ([storedData, storedOptions]) =>
    this.resolver(storedData, data) && Object.is(storedOptions, options)
  );
  if (document) return document[2];
  else return false;
 }

 /** @internal Sets a document in the cache */
 public set(
  data: SingleOrArray<PrimaryType> | nullish,
  document: DataDocument<PrimaryType>,
  options?: Partial<SerializerOptions<PrimaryType>>
 ) {
  if (this.storage.length > this.limit) {
   this.storage.shift();
  }
  this.storage.push([data, options, document]);
  return document;
 }
}
