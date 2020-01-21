import React from 'react';

// Import images

// OI4-Logos
import oi4BigLogoLight from './Images/OI4_Logo_complete_color_RGB.png';
import oi4BigLogoDark from './Images/OI4_Logo_complete_white_RGB.png';
import oi4SmallLogoLight from './Images/OI4_Signet_color_RGB.png';
import oi4SmallLogoDark from './Images/OI4_Signet_white_RGB.png';

import { MuiThemeProvider, createMuiTheme, withStyles } from '@material-ui/core/styles';
import PropTypes from 'prop-types';

import Checkbox from '@material-ui/core/Checkbox';
import Toolbar from '@material-ui/core/Toolbar';
import AppBar from '@material-ui/core/AppBar';

import {
  Typography,
  ExpansionPanel,
  ExpansionPanelDetails,
  ExpansionPanelSummary,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@material-ui/core';

import CssBaseline from '@material-ui/core/CssBaseline';
import {
  BrightnessHigh,
  Brightness3,
  ExpandMore,
} from '@material-ui/icons';

import _ from 'lodash';
import { reject } from 'q';
import { CommonFetch } from './Helper/CommonFetch/index';

// Import custom components
import { ClickableFooter } from './Components/ClickableFooter';
import ExpansionTable from './Components/ExpansionTable';

const pjson = require('../package.json');

const darkTheme = createMuiTheme({
  palette: {
    secondary: {
      light: '#80e27e',
      main: '#4caf50',
      dark: '#087f23',
      contrastText: '#fff',
    },
    primary: {
      light: '#8559da',
      main: '#512da8',
      dark: '#140078',
      contrastText: '#000',
    },
    type: 'dark',
  },
});

const lightTheme = createMuiTheme({
  palette: {
    secondary: {
      light: '#80e27e',
      main: '#4caf50',
      dark: '#087f23',
      contrastText: '#fff',
    },
    primary: {
      light: '#8559da',
      main: '#512da8',
      dark: '#140078',
      contrastText: '#000',
    },
  }
});

const styles = theme => ({
  root: {
    paddingLeft: '120px',
    paddingRight: '120px',
    display: 'flex',
    minHeight: '100vh',
    flexDirection: 'column',
  },
  paper: {
    padding: theme.spacing(2),
    marginTop: theme.spacing(3),
    width: '100%',
    overflowX: 'auto',
    marginBottom: theme.spacing(2),
  },
});

class OI4Base extends React.Component {
  constructor(props) {
    super(props);
    this.platform = 'fetch';
    // The following lines will give access to the external Endpoint for the REST API defined by the Environment variables.
    // This way, the registry backend is fully decoupled from the front-end
    /* eslint-disable */
    if (typeof serviceEndpoint === 'object' && serviceEndpoint !== null) {
      this.address = serviceEndpoint.address;
      this.port = serviceEndpoint.port;
      this.platform = serviceEndpoint.platform;
    }
    // Since Cockpit uses a different approach to fetch data, we introduced a common API, which can be accessed by both
    // the local UI and the cockpit frontend.
    // Change the first argument to either 'fetch' or 'cockpit' depending on your use-case!
    this.fetch = new CommonFetch(this.platform, this.address, this.port);
    /* eslint-enable */

    this.state = {
      appId: 'empty',
      applicationLookup: {},
      deviceLookup: {},
      conformityLookup: {},
      footerExpanded: false,
      config: {
        developmentMode: false,
        globalEventListLength: 10,
        assetEventListLength: 3,
      },
      theme: lightTheme,
      darkActivated: false,
      // TODO: Remove these hardcoded links and replace with relative images...
      smallLogo: oi4SmallLogoLight,
      bigLogo: oi4BigLogoLight,
      globalEventTrail: [],
      updatingConformity: false,
    };

    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.activeIntervals = [];
    // Update apps and devices right away
    setTimeout(() => { this.updateApplications() }, 500);
    setTimeout(() => { this.updateDevices() }, 800);
    /**
     * Setup cyclic intervals for refreshing the data managed by the registry backend.
     * The resources kept by the registry of all applications are updated individually.
     */
    this.activeIntervals.push(setInterval(() => { this.updateHealth() }, 7000)); // UpdateHealth gets the health of the registry
    this.activeIntervals.push(setInterval(() => { this.updateApplications() }, 7000));
    this.activeIntervals.push(setInterval(() => { this.updateDevices() }, 7000));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('health') }, 8100));
    // this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('config') }, 8200));
    // this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('rtLicense') }, 8300));
    // this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('license') }, 8400));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('eventList') }, 8500));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('lastMessage') }, 5000));
    // this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('profile') }, 8600));
    this.activeIntervals.push(setInterval(() => { this.updateGlobalEventTrail() }, 10000));

    // If we start out with a couple of applications, we should update their conformity right away
    // setTimeout(() => {
    //   for (const oi4Id of Object.keys(this.state.applicationLookup)) {
    //     this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath, this.state.applicationLookup[oi4Id].appId);
    //   }
    //   for (const oi4Id of Object.keys(this.state.deviceLookup)) {
    //     this.updateConformity(this.state.deviceLookup[oi4Id].fullDevicePath, this.state.deviceLookup[oi4Id].appId);
    //   }
    // },
    //   2000);
    this.updateAppID(); // This will retrieve the AppID of the registry itself.
    setTimeout(() => {
      this.toggleTheme();
    },
      100);
  }

  componentDidMount() {
    document.body.style.fontSize = '14px';
  }

  // On close, clear all cyclic intervals
  componentWillUnmount() {
    for (const intervals of this.activeIntervals) {
      clearInterval(intervals);
    }
  }

  render() {
    const { classes } = this.props;
    return (
      <React.Fragment>
        <MuiThemeProvider theme={this.state.theme}>
          <CssBaseline />
          <div className={classes.root}>
            <AppBar position='static' color='inherit'>
              <Toolbar>
                <img src={this.state.bigLogo} alt="OI4Logo" style={{ marginRight: '10px', maxWidth: '180px', height: 'auto' }} />
                <Typography variant='h6' style={{ flexGrow: 1 }}>Registry</Typography>
                <Checkbox
                  icon={<BrightnessHigh />}
                  checkedIcon={<Brightness3 />}
                  checked={this.state.darkActivated}
                  style={{ right: '30px' }}
                  onChange={() => { this.toggleTheme() }}
                />
              </Toolbar>
            </AppBar>
            <div style={{ marginTop: '30px' }}>
              <ExpansionTable
                lookupType='application'
                assetLookup={this.state.applicationLookup}
                conformityLookup={this.state.conformityLookup}
                updateConformity={this.updateConformity.bind(this)}
                fontColor={this.state.theme.palette.text.default}
                updatingConformity={this.state.updatingConformity}
                expertMode={this.state.config.developmentMode}
                clearAsset={this.clearAssetById.bind(this)}
              />
              <ExpansionTable
                lookupType='device'
                assetLookup={this.state.deviceLookup}
                conformityLookup={this.state.conformityLookup}
                updateConformity={this.updateConformity.bind(this)}
                updatingConformity={this.state.updatingConformity}
                expertMode={this.state.config.developmentMode}
                clearAsset={this.clearAssetById.bind(this)}
              />
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMore />}> Global Event Trail: ({this.state.globalEventTrail.length} entries)</ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.paper}>
                  {this.displayEvents(this.state.globalEventTrail)}
                </ExpansionPanelDetails>
              </ExpansionPanel>

            </div>{/* Padding for dialog */}
            <div style={{ flexGrow: 1 }} />
            <ClickableFooter
              clearAllAssets={this.clearAllAssets.bind(this)}
              config={this.state.config}
              handleExpertChange={this.handleExpertChange.bind(this)}
              handleLocalTrailLength={this.setlocalTrailLength.bind(this)}
              handleGlobalTrailLength={this.setGlobalTrailLength.bind(this)}
              handleGetTrailLength={this.getTrailLength.bind(this)}
              handleSetTrailLength={this.setTrailLength.bind(this)}
              handleUpdateTrail={this.updateGlobalEventTrail.bind(this)}
              saveToFile={this.saveToFile.bind(this)}
              license='BSD License'
              version={pjson.version}
              bigLogo={this.state.bigLogo}
            />
          </div>
        </MuiThemeProvider>
      </React.Fragment>
    );
  }

  handleExpertChange = (event, newValue) => {
    const oldConfigObj = JSON.parse(JSON.stringify(this.state.config));
    oldConfigObj.developmentMode = !oldConfigObj.developmentMode;
    this.setState({ config: oldConfigObj });
  }

  /**
   * Toggles the theme between light and dark and switches the logos accordingly
   *
   * @memberof OI4Base
   */
  toggleTheme() {
    if (this.state.darkActivated) {
      this.setState({ darkActivated: false, theme: lightTheme, smallLogo: oi4SmallLogoLight, bigLogo: oi4BigLogoLight });
    } else {
      this.setState({ darkActivated: true, theme: darkTheme, smallLogo: oi4SmallLogoDark, bigLogo: oi4BigLogoDark });
    }
  }

  /**
   * Displays the Events / Events coming from either global or local data sources
   * @param {array} eventArray - an array of the last few events
   * @param {string} mode - the mode with which the events will be displayed (local: without originId, global: with originId)
   */
  displayEvents(eventArray, mode = 'global') {
    if (Array.isArray(eventArray)) {
      if (mode === 'global') {
        return <Table>
          <TableHead>
            <TableRow>
              <TableCell key='GlobalEventsOrigin'>OriginID</TableCell>
              <TableCell key='GlobalEventsNumber'>Number</TableCell>
              <TableCell key='GlobalEventsDesc'>Description</TableCell>
              <TableCell key='GlobalEventsPayload'>Payload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {
              eventArray.map((events, idx) => {
                return <TableRow key={`GlobalEvents-${idx}`}>
                  <TableCell component="th" scope="row">{events.originId}</TableCell>
                  <TableCell component="th" scope="row">{events.number}</TableCell>
                  <TableCell component="th" scope="row">{events.description}</TableCell>
                  <TableCell component="th" scope="row">{JSON.stringify(events.payload)}</TableCell>
                </TableRow>;
              })
            }
          </TableBody>
        </Table>;
      } else if (mode === 'local') {
        return <Table>
          <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Payload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {
              eventArray.map((events, idx) => {
                return <TableRow key={`LocalEvents-${idx}`}>
                  <TableCell component="th" scope="row">{events.number}</TableCell>
                  <TableCell component="th" scope="row">{events.description}</TableCell>
                  <TableCell component="th" scope="row">{JSON.stringify(events.payload)}</TableCell>
                </TableRow>;
              })
            }
          </TableBody>
        </Table>;
      }
    }
  }

  // -- CONFORMITY HELPERS
  /**
   * Updates the conformity of the specified asset via the Registry API
   *
   * @param {string} fullTopic - The full topic pointing to the asset
   * @param {string} appId - The appId of the asset
   * @memberof OI4Base
   */
  updateConformity(fullTopic, appId) {
    this.setState({ updatingConformity: true });
    console.log(`Updating Conformity for ${fullTopic} with appId: ${appId}`);
    const oi4Id = appId;
    if (this.state.config.developmentMode === true) { // If we're in development mode, we retrieve *all* conformity values
      this.fetch.get(`/fullConformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(appId)}`)
        .then(data => {
          this.setState({ updatingConformity: false });
          const jsonData = JSON.parse(data);
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          this.setState({ conformityLookup: confLookup, updatingConformity: false });
        });
    } else { // If not, retrieve only mandatory conformity values
      this.fetch.get(`/conformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(appId)}`)
        .then(data => {
          this.setState({ updatingConformity: false });
          const jsonData = JSON.parse(data);
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          this.setState({ conformityLookup: confLookup, updatingConformity: false });
        });
    }
  }

  // UPDATE HELPERS
  /**
   * Fetch the devices via the registry API
   *
   * @memberof OI4Base
   */
  updateDevices() {
    this.fetch.get(`/registry/device`)
      .then(data => {
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          if (this.state.deviceLookup[oi4Id] === undefined || this.state.deviceLookup[oi4Id] === null) {
            // const fullTopic = jsonData[oi4Id].fullDevicePath;
            // const appId = jsonData[oi4Id].appId;
            // this.updateConformity(fullTopic, appId); // Update only when pressing the refresh button
          }
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
          confLookupLoc[oi4Id] = jsonData[oi4Id].conformityObject;
        }
        this.setState({ deviceLookup: jsonData, conformityLookup: confLookupLoc });
      });
  }

  /**
   * Fetch the applications via the registry API
   *
   * @memberof OI4Base
   */
  updateApplications() {
    this.fetch.get(`/registry/application`)
      .then(data => {
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          if (this.state.applicationLookup[oi4Id] === undefined || this.state.applicationLookup[oi4Id] === null) {
            // const fullTopic = jsonData[oi4Id].fullDevicePath;
            // const appId = jsonData[oi4Id].appId;
            // this.updateConformity(fullTopic, appId); // Update only when pressing the refresh button
          }
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
          confLookupLoc[oi4Id] = jsonData[oi4Id].conformityObject;
          // console.log(`New Conformity object for ${oi4Id}`);
          // console.log(confLookupLoc[oi4Id]);
        }
        this.setState({ applicationLookup: jsonData, conformityLookup: confLookupLoc });
      });
  }

  /**
   * Fetches the specified resource for all applications/devices we know
   * @param {string} resource - the requested resource
   */
  updateRegistryResource(resource) {
    for (const oi4Id of Object.keys(this.state.applicationLookup)) {
      // Check, if we can even get the resource (through conformity lookup)
      if (typeof this.state.conformityLookup[oi4Id] === 'object' && this.state.conformityLookup[oi4Id] !== null) {
        if (resource === 'eventList' || resource === 'lastMessage') {
          this.fetch.get(`/registry/${resource}/${encodeURIComponent(oi4Id)}`)
            .then(data => {
              const resourceObject = JSON.parse(data);
              // TODO: Remove everything except setState and update function!
              const applicationLookupLoc = JSON.parse(JSON.stringify(this.state.applicationLookup));
              if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                if (typeof resourceObject === 'object' && resourceObject !== null) {
                  if ('err' in resourceObject) {
                    console.log(`Received Error in updateRegistryResource (${resource})`);
                    console.log(resourceObject);
                  }
                } else {
                  applicationLookupLoc[oi4Id][resource] = resourceObject;
                }
              }
              this.setState({ applicationLookup: applicationLookupLoc });
            })
            .catch(err => {
              // console.log(`Error ${err} with Resource ${resource}`);
              reject(err);
            });
        } else { // If we don't have it in our lookup, we can return!
          if (typeof this.state.conformityLookup[oi4Id].resource[resource] !== 'undefined') {
            // console.log(`The resource ${resource} could not be requested yet, because we are waiting for conformity`);
            return;
          }
          this.fetch.get(`/registry/${resource}/${encodeURIComponent(oi4Id)}`)
            .then(data => {
              const resourceObject = JSON.parse(data);
              // TODO: Remove everything except setState and update function!
              const applicationLookupLoc = JSON.parse(JSON.stringify(this.state.applicationLookup));
              if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                applicationLookupLoc[oi4Id][resource] = resourceObject;
              }
              this.setState({ applicationLookup: applicationLookupLoc });
            })
            .catch(err => {
              console.log(`Error ${err} with Resource ${resource}`);
              reject(err);
            });
        }
      }
    }
  }

  clearAllAssets() {
    console.log('caa clicked');
    this.fetch.delete(`/registry/assets`)
      .then(data => {
        console.log(data);
      });
  }

  clearAssetById(oi4Id) {
    console.log('cabid clicked');
    this.fetch.delete(`/registry/assets/${encodeURIComponent(oi4Id)}`)
      .then(data => {
        console.log(data);
      });
  }

  /**
   * Fetch the most recent health of the Registry
   *
   * @memberof OI4Base
   */
  updateHealth() {
    this.fetch.get(`/health`)
      .then(data => {
        this.setState({ health: JSON.parse(data) });
      });
  }

  /**
   * Fetch the most recent config of the Registry
   *
   * @memberof OI4Base
   */
  updateConfig() {
    this.fetch.get(`/config`)
      .then(data => {
        this.setState({ config: JSON.parse(data) });
      });
  }

  /**
   * Fetch the AppID of the Registry
   *
   * @memberof OI4Base
   */
  updateAppID() {
    this.fetch.get('')
      .then(data => {
        console.log(data);
        this.setState({ appId: JSON.parse(data) });
      });
  }

  /**
   * Fetch the most recent event trail from the Registry
   *
   * @memberof OI4Base
   */
  updateGlobalEventTrail() {
    this.fetch.get(`/registry/event`)
      .then(data => {
        this.setState({ globalEventTrail: JSON.parse(data) });
      });
  }

  // SETTERS
  // setConfig(newConfig) { // eslint-disable-line no-unused-vars
  //   // TODO!
  // }
  setlocalTrailLength(ev) {
    const configObj = JSON.parse(JSON.stringify(this.state.config));
    configObj.assetEventListLength = ev.target.value;
    this.setState({ config: configObj });
  }

  setGlobalTrailLength(ev) {
    const configObj = JSON.parse(JSON.stringify(this.state.config));
    configObj.globalEventListLength = ev.target.value;
    this.setState({ config: configObj });
  }

  setTrailLength() {
    const myConf = {
      globalEventListLength: this.state.config.globalEventListLength,
      assetEventListLength: this.state.config.assetEventListLength,
    };
    console.log('setting myconf to');
    console.log(myConf);
    this.fetch.put(`/registry/config`, JSON.stringify(myConf))
      .then(data => {
        console.log(data);
      });
  }

  getTrailLength() {
    this.fetch.get(`/registry/config`)
      .then(data => {
        const regConfData = JSON.parse(data);
        const globLength = regConfData.globalEventListLength;
        const assetLength = regConfData.assetEventListLength;
        const confCopy = JSON.parse(JSON.stringify(this.state.config));
        confCopy.globalEventListLength = globLength;
        confCopy.assetEventListLength = assetLength;
        this.setState({ config: confCopy });
      });
  }

  saveToFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.state.config));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", 'configDmp' + ".json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }
}

OI4Base.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles, { withTheme: true })(OI4Base);
