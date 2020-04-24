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
  IContainerProfile,
  IContainerPublicationList,
  IContainerSubscriptionList,
  EPublicationListConfig,
  ESubscriptionListConfig,
} from '../Models/IContainer';

import { IOPCUAData, IOPCUAMetaData, IMasterAssetModel, EOPCUALocale } from '../Models/IOPCUAPayload';

import masterAssetModel from '../../Config/masterAssetModel.json'; /*tslint:disable-line*/

class ContainerState extends ConfigParser implements IContainerState {
  public oi4Id: string; // TODO: doubling? Not needed here
  public health: IContainerHealth;
  public license: IContainerLicense;
  public licenseText: IContainerLicenseText;
  public rtLicense: IContainerRTLicense;
  public dataLookup: IContainerData;
  public metaDataLookup: IContainerMetaData;
  public mam: IMasterAssetModel;
  public profile: IContainerProfile;
  public publicationList: IContainerPublicationList;
  public subscriptionList: IContainerSubscriptionList;

  constructor() {
    super();

    this.mam = masterAssetModel as IMasterAssetModel; // Import MAM from JSON
    this.mam.Description.Locale = EOPCUALocale.enUS; // Fill in container-specific values
    this.mam.SerialNumber = process.env.CONTAINERNAME as string;
    this.mam.ProductInstanceUri = `${this.mam.ManufacturerUri}/${encodeURIComponent(this.mam.Model.Text)}/${encodeURIComponent(this.mam.ProductCode)}/${encodeURIComponent(this.mam.SerialNumber)}`;
    this.oi4Id = this.mam.ProductInstanceUri;
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
              component: 'Async-Mqtt.js',
              licAuthor: [
                'Adam Rudd',
                'Octavian Ionescu',
                'Nick O\'Leary',
                'Matteo Collina',
                'Nicholas Dudfield',
                'Wouter Klijn',
                'Yohei Onishi',
                'RangerMauve',
              ],
              licAddText: 'https://www.npmjs.com/package/async-mqtt',
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
                'sindresorhus',
                'Qix-',
                'et al',
              ],
              licAddText: 'https://www.npmjs.com/package/chalk',
            },
            {
              component: 'uuid',
              licAuthor: [
                'ctavan',
                'broofa',
                'defunctzombie',
                'solderjs',
                'benjreinhart',
                'et al',
              ],
              licAddText: 'https://www.npmjs.com/package/uuid',
            },
            {
              component: 'ajv',
              licAuthor: [
                'epoberezkin',
                'blakeembrey',
                'gajus',
                'et al',
              ],
              licAddText: 'https://www.npmjs.com/package/ajv',
            },
          ],
        },
        {
          licenseId: 'BSD2',
          components: [
            {
              component: 'dotenv',
              licAuthor: [
                'motdotla',
                'maxbeatty',
                'jcblw',
                'jessefulton',
                'et al',
              ],
              licAddText: 'https://www.npmjs.com/package/dotenv',
            },
          ],
        },
        {
          licenseId: 'BSD3',
          components: [
            {
              component: 'OI4-Registry',
              licAuthor: [
                'OI4-Hilscher',
                'Berti Martens',
              ],
              licAddText: 'none',
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
      BSD2: `(BSD 2-Clause License)
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
      BSD3: `(BSD 3-Clause License)
      All rights reserved.

      Redistribution and use in source and binary forms, with or without
      modification, are permitted provided that the following conditions are met:

      1. Redistributions of source code must retain the above copyright notice, this
         list of conditions and the following disclaimer.

      2. Redistributions in binary form must reproduce the above copyright notice,
         this list of conditions and the following disclaimer in the documentation
         and/or other materials provided with the distribution.

      3. Neither the name of the copyright holder nor the names of its
         contributors may be used to endorse or promote products derived from
         this software without specific prior written permission.

      THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
      AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
      IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
      DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
      FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
      DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
      SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
      CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
      OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
      OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
      `,
    };

    this.rtLicense = {

    };

    this.dataLookup = {};
    this.metaDataLookup = {};

    this.profile = {
      resource: [
        'health',
        'license',
        'rtLicense',
        'config',
        'mam',
        'profile',
        'licenseText',
        'publicationList',
        'subscriptionList',
      ],
    };

    this.publicationList = {
      publicationList: [

      ],
    };

    this.subscriptionList = {
      subscriptionList: [

      ],
    };

    // Fill both pubList and subList
    for (const resources of this.profile.resource) {
      let resInterval = 0;
      if (resources === 'health') {
        resInterval = 60000;
      } else {
        resInterval = 0;
      }
      this.publicationList.publicationList.push({
        resource: resources,
        tag: this.oi4Id,
        DataSetWriterId: this.oi4Id,
        status: true,
        interval: resInterval,
        precision: 0,
        config: EPublicationListConfig.NONE_0,
      });

      this.subscriptionList.subscriptionList.push({
        topicPath: `oi4/${this.mam.DeviceClass}/${this.oi4Id}/get/${resources}/${this.oi4Id}`,
        interval: 0,
        config: ESubscriptionListConfig.NONE_0,
      });
    }

  }

  /**
   * Add a DataSet to the container, so that it can be sent externally via an application
   * @param key - the key under which the dataset will be saved as (data / metadata)
   * @param data - the completely built OPCUA Data message
   * @param metadata - the completely build OPCUA Metadata message (optional)
   */
  public addDataSet(key: string, data: IOPCUAData, metadata?: IOPCUAMetaData) {
    this.dataLookup[key] = data;
    if (metadata) {
      this.metaDataLookup[key] = metadata;
    }
  }
}

export { ContainerState, IContainerState, IContainerConfig, IContainerRTLicense };
