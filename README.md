## Introduction
The OEC Registry is the first container to start on the bus and monitors onboarding and offboarding assets as well as their audit trail and their health state. It can be used to do a basic check on the stats of the assets and perform a simple conformity validation check.

![firefox_PunxEH5tof](https://user-images.githubusercontent.com/55870966/88534795-1d1dd980-d009-11ea-9a30-eb5094d54c77.png)

![firefox_glIWnXYIXJ](https://user-images.githubusercontent.com/55870966/88534811-24dd7e00-d009-11ea-8699-b6267e277cb8.png)

## Getting started
- Set environment variable for GitHub package repo (PAT) with, e.g. ```export PACKAGES_AUTH_TOKEN=123```
- yarn install
- yarn build
- (one time) yarn run docker:prepare
- yarn run docker:build:local

## Wiki
Most of the previous entries of this README were moved to the Wiki portion of the Repository ([Click](https://github.com/OI4/oi4-registry/wiki))

### Disclaimer:
The entire project is in a development stage until the final specification of the Development Guideline is finished. Use at own discretion.
