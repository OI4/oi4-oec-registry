import {IAsset} from './IRegistry';
import { Oi4Identifier } from '@oi4/oi4-oec-service-opcua-model';

export class AssetLookup implements IterableIterator<IAsset> {

    private readonly _assets: Map<string, IAsset>;
    private index = 0;

    constructor() {
        this._assets = new Map<string, IAsset>();
    }

    [Symbol.iterator](): IterableIterator<IAsset> {
        return this._assets.values();
    }

    next(): IteratorResult<IAsset> {
        const assets = [... this._assets.values()];
        if (this.index <  assets.length) {
            return {
                done: false,
                value: assets[this.index++]
            }
        }

        this.index = 0;
        return {
            done: true,
            value: undefined
        }
    }

    public has(oi4Id: Oi4Identifier): boolean {
        return oi4Id && this._assets.has(oi4Id.toString());
    }

    public set(oi4Id: Oi4Identifier, asset: IAsset): void {
        this._assets.set(oi4Id.toString(), asset);
    } 

    public get(oi4Id: Oi4Identifier): IAsset {
        return this._assets.get(oi4Id.toString());
    }

    public delete(oi4Id: Oi4Identifier): boolean {
        return this._assets.delete(oi4Id.toString());
    }

    public clear(): void {
        this._assets.clear();
    }

    public get size(): number {
        return this._assets.size;
    }
}
