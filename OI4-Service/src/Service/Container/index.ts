import { ConfigParser } from '../Utilities/ConfigParser/index';
import {
  IContainerState,
  IContainerConfig,
  IContainerHealth,
  IContainerLicense,
  IContainerLicenseText,
  IContainerRTLicense,
  IContainerData,
  IContainerMetaData,
  EDeviceHealth,
} from '../Models/IContainer';

import { IOPCUAData, IOPCUAMetaData, IMasterAssetModel, EOPCUALocale } from '../Models/IOPCUAPayload';

import masterAssetModel from '../../Config/masterAssetModel.json'; /*tslint:disable-line*/

class ContainerState extends ConfigParser implements IContainerState {
  public appId: string;
  public health: IContainerHealth;
  public license: IContainerLicense;
  public licenseText: IContainerLicenseText;
  public rtLicense: IContainerRTLicense;
  public dataLookup: IContainerData;
  public metaDataLookup: IContainerMetaData;
  public masterAssetModel: IMasterAssetModel;
  public profile: string[];

  constructor() {
    super();

    this.masterAssetModel = masterAssetModel as IMasterAssetModel; // Import MAM from JSON
    this.masterAssetModel.Description.Locale = EOPCUALocale.enUS; // Fill in container-specific values
    this.masterAssetModel.SerialNumber = process.env.CONTAINERNAME as string;

    this.appId = `${encodeURIComponent(this.masterAssetModel.ManufacturerUri)}/${encodeURIComponent(this.masterAssetModel.Model)}/${encodeURIComponent(this.masterAssetModel.ProductCode)}/${encodeURIComponent(this.masterAssetModel.SerialNumber)}`;
    this.masterAssetModel.ProductInstanceUri = `${this.masterAssetModel.ManufacturerUri}/${encodeURIComponent(this.masterAssetModel.Model)}/${encodeURIComponent(this.masterAssetModel.ProductCode)}/${encodeURIComponent(this.masterAssetModel.SerialNumber)}`;

    this.health = {
      health: EDeviceHealth.NORMAL_0,
      healthState: 100,
    };

    this.license = {
      licenses: [
        {
          licenseId: 'MIT',
          components: [
            {
              component: 'Mqtt.js',
              licAuthor: [
                'Adam Rudd',
                'Octavian Ionescu',
                'Nick O\'Leary',
                'Matteo Collina',
                'Nicholas Dudfield',
                'Wouter Klijn',
                'Yohei Onishi',
              ],
              licAddText: 'https://www.npmjs.com/package/mqtt',
            },
            {
              component: 'Express.js',
              licAuthor: [
                'Andrew Kelley',
                'Ryan',
                'Rand McKinney',
                'Yiyu He',
                'Douglas Wilson',
                'fengmk2',
                'Jeremiah Senkpiel',
                'et al',
              ],
              licAddText: 'https://www.npmjs.com/package/express',
            },
            {
              component: 'chalk',
              licAuthor: [
                'TODO',
              ],
              licAddText: 'https://www.npmjs.com/package/chalk',
            },
            {
              component: 'uuid',
              licAuthor: [
                'TODO',
              ],
              licAddText: 'https://www.npmjs.com/package/uuid',
            },
          ],
        },
        {
          licenseId: 'BSD2',
          components: [
            {
              component: 'dotenv',
              licAuthor: [
                'TODO',
              ],
              licAddText: 'https://www.npmjs.com/package/dotenv',
            },
          ],
        },
      ],
    };

    this.licenseText = {
      MIT: `(The MIT License)
      Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca>
      Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com>
      Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>

      Permission is hereby granted, free of charge, to any person obtaining
      a copy of this software and associated documentation files (the
      'Software'), to deal in the Software without restriction, including
      without limitation the rights to use, copy, modify, merge, publish,
      distribute, sublicense, and/or sell copies of the Software, and to
      permit persons to whom the Software is furnished to do so, subject to
      the following conditions:

      The above copyright notice and this permission notice shall be
      included in all copies or substantial portions of the Software.

      THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
      EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
      MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
      IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
      CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
      TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
      SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
      BSD2: `Copyright (c) 2015, Scott Motte
      All rights reserved.
      Redistribution and use in source and binary forms, with or without
      modification, are permitted provided that the following conditions are met:

      * Redistributions of source code must retain the above copyright notice, this
        list of conditions and the following disclaimer.

      * Redistributions in binary form must reproduce the above copyright notice,
        this list of conditions and the following disclaimer in the documentation
        and/or other materials provided with the distribution.

      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
      AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
      IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
      DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
      FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
      DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
      SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
      CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
      OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
      OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
    };

    this.rtLicense = {
      expiryDate: new Date('December 24, 2022 00:00:00').toISOString(),
      validated: true,
      customerName: 'MyCompanyName',
      certificate: 'myCert.crt',
    };

    this.dataLookup = {};
    this.metaDataLookup = {};

    this.profile = [
      'health',
      'license',
      'rtLicense',
      'config',
      'mam',
      'profile',
      'licenseText',
    ];
  }

  /**
   * Add a DataSet to the container, so that it can be sent externally via an application
   * @param key - the key under which the dataset will be saved as (data / metadata)
   * @param data - the completely built OPCUA Data message
   * @param metadata - the completely build OPCUA Metadata message (optional)
   */
  public addDataSet(key:string, data: IOPCUAData, metadata?: IOPCUAMetaData) {
    this.dataLookup[key] = data;
    if (metadata) {
      this.metaDataLookup[key] = metadata;
    }
  }
}

export { ContainerState, IContainerState, IContainerConfig, IContainerRTLicense };
