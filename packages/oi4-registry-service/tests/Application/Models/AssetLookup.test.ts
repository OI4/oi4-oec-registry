import {AssetLookup} from '../../../src/Application/Models/AssetLookup';
import { IAsset } from '../../../src/Application/Models/IRegistry';
import { EOPCUALocale, Oi4Identifier } from '@oi4/oi4-oec-service-opcua-model';
import { EAssetType, Resource } from '@oi4/oi4-oec-service-model';
import { EValidity } from '@oi4/oi4-oec-service-conformity-validator';

let objectUnderTest: AssetLookup;
const asset1: IAsset = {
    resources: {
        mam: {
            Description: {locale: EOPCUALocale.enUS, text: 'Test device'},
            DeviceClass: 'Oi4.OTConnector',
            DeviceManual: 'www.vendor.com/manual.pdf',
            DeviceRevision: '1',
            getServiceType: jest.fn(),
            HardwareRevision: '',
            SoftwareRevision: '1.0.0',
            Manufacturer: {locale: EOPCUALocale.enUS, text: 'vendor'},
            Model: {locale: EOPCUALocale.enUS, text: 'a'},
            SerialNumber: 'c',
            ProductCode: 'b',
            resourceType: ()=> { return Resource.MAM; },
            ManufacturerUri: 'vendor.com',
            ProductInstanceUri: '1234',
            RevisionCounter: 0,
            getOI4Id: jest.fn()
        }},
        assetType: EAssetType.application,
        conformityObject: {
            oi4Id: EValidity.default,
            checkedResourceList: [],
            nonProfileResourceList: [],
            profileResourceList: [],
            resource: {},
            validity: EValidity.default
        },
        lastMessage: '',
        oi4Id: new Oi4Identifier('vendor.com', 'a', 'b', 'c'),
        oi4IdOriginator: new Oi4Identifier('vendor.com', 'a', 'b', 'c'),
        registeredAt: '',
        topicPreamble: ''
};

const asset2: IAsset = {
    ... asset1,
    oi4Id: new Oi4Identifier('othervendor.com', '1', '2', '3')
}

describe('Unit test for AssetLooku', ()=> {

    beforeEach(() => {
        objectUnderTest = new AssetLookup();
    });

    it ('Get asset with similar (but not same) identifier', ()=> {
        const ident1 = new Oi4Identifier('vendor.com', 'a', 'b', 'c');
        const ident2 = new Oi4Identifier('vendor.com', 'a', 'b', 'c');

        objectUnderTest.set(ident1, asset1);

        expect(objectUnderTest.has(ident2)).toBeTruthy();
        const asset = objectUnderTest.get(ident2);
        expect(asset).toEqual(asset1);
    })

    it ('Can iterate over all assets', ()=> {
        objectUnderTest.set(new Oi4Identifier('vendor.com', 'a', 'b', 'c'), asset1);
        objectUnderTest.set(new Oi4Identifier('othervendor.com', '1', '2', '3'), asset2);

        expect(objectUnderTest.size).toBe(2);

        const assets: IAsset[] = [];
        for (const asset of objectUnderTest)
        {
            assets.push(asset);
        }

        expect(assets.length).toBe(2);
        expect(assets).toContain(asset1);
        expect(assets).toContain(asset2);
    })

    it ('Next returns next value', ()=> {
        objectUnderTest.set(new Oi4Identifier('vendor.com', 'a', 'b', 'c'), asset1);
        objectUnderTest.set(new Oi4Identifier('othervendor.com', '1', '2', '3'), asset2);

        const assets: IAsset[] = [];
        assets.push(objectUnderTest.next().value);
        assets.push(objectUnderTest.next().value);

        expect(assets.length).toBe(2);
        expect(assets).toContain(asset1);
        expect(assets).toContain(asset2);
        expect(objectUnderTest.next().done).toBeTruthy();
    })
})