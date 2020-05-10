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

import MaterialTable from 'material-table';

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
  IconButton,
  Snackbar,
  Tooltip,
  TextField,
  InputAdornment,
} from '@material-ui/core';

import CssBaseline from '@material-ui/core/CssBaseline';
import {
  BrightnessHigh,
  Brightness3,
  ExpandMore,
  FileCopy,
  Close,
  Search,
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
    paddingLeft: '3%',
    paddingRight: '3%',
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
      oi4Id: 'empty',
      copySnackOpen: false,
      applicationLookup: {},
      deviceLookup: {},
      listOfDevices: [],
      listOfApps: [],
      conformityLookup: {},
      footerExpanded: false,
      config: {
        auditTrailLength: 25,
      },
      backendConfig: {
        auditLevel: 'trace',
        showRegistry: true,
        logToFile: 'disabled',
        logFileSize: 250, // In kiloByte FIXME: THIS IS NOT 1:1 to the backend...
        developmentMode: false,
      },
      theme: lightTheme,
      darkActivated: false,
      smallLogo: oi4SmallLogoLight,
      bigLogo: oi4BigLogoLight,
      globalEventTrail: [],
      updatingConformity: false,
      filterWord: '',
    };

    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.activeIntervals = [];

    // Update apps and devices right away
    setTimeout(() => { this.updateApplications() }, 500);
    setTimeout(() => { this.updateDevices() }, 800);
    setTimeout(() => { this.getBackendConfig() }, 300);

    /**
     * Setup cyclic intervals for refreshing the data managed by the registry backend.
     * The resources kept by the registry of all applications are updated individually.
     */
    this.activeIntervals.push(setInterval(() => { this.updateHealth() }, 7000)); // UpdateHealth gets the health of the registry
    this.activeIntervals.push(setInterval(() => { this.updateApplications() }, 6000));
    this.activeIntervals.push(setInterval(() => { this.updateDevices() }, 6000));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('health') }, 7000));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('eventList') }, 3500));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('lastMessage') }, 5000));
    this.activeIntervals.push(setInterval(() => { this.updateGlobalEventTrail() }, 10000));

    setTimeout(() => { this.updateOi4Id() }, 300); // This will retrieve the oi4Id of the registry itself.
    setTimeout(() => {
      this.toggleTheme();
    },
      100);
  }

  componentDidMount() {
    document.body.style.fontSize = '14px';
  }

  componentWillUnmount() {
    for (const intervals of this.activeIntervals) {
      clearInterval(intervals);
    }
  }

  handleFilterChange(ev) {
    this.setState({ filterWord: ev.target.value });
  }

  /**
   * Main render method of the entrypoint
   * @memberof OI4Base
   */
  render() {
    const { classes } = this.props;
    // const filteredTrail = this.state.globalEventTrail // TODO: Maybe get this to another place?
    //   .filter((item) => {
    //     if (this.state.filterWord === '') return true;
    //     if (item.Tag.includes(this.state.filterWord)) return true;
    //     if (item.description.includes(this.state.filterWord)) return true;
    //     if (item.number.toString().includes(this.state.filterWord)) return true;
    //     if (JSON.stringify(item.payload).includes(this.state.filterWord)) return true;
    //     return false;
    //   });
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
                  style={{ right: '1%' }}
                  onChange={() => { this.toggleTheme() }}
                />
              </Toolbar>
            </AppBar>
            <div style={{ marginTop: '5%' }}>
              <ExpansionTable
                lookupType='application'
                assetLookup={this.state.applicationLookup}
                listOfAssets={this.state.listOfApps}
                conformityLookup={this.state.conformityLookup}
                updateConformity={this.updateConformity.bind(this)}
                fontColor={this.state.theme.palette.text.default}
                updatingConformity={this.state.updatingConformity}
                expertMode={this.state.backendConfig.developmentMode}
                clearAsset={this.clearAssetById.bind(this)}
              />
              <ExpansionTable
                lookupType='device'
                assetLookup={this.state.deviceLookup}
                listOfAssets={this.state.listOfDevices}
                conformityLookup={this.state.conformityLookup}
                updateConformity={this.updateConformity.bind(this)}
                updatingConformity={this.state.updatingConformity}
                expertMode={this.state.backendConfig.developmentMode}
                clearAsset={this.clearAssetById.bind(this)}
              />
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMore />}>
                  Global Event Trail: ({this.state.globalEventTrail.length} entries)
                  {/* <TextField
                    id='filterText'
                    value={this.state.filterWord}
                    onChange={this.handleFilterChange.bind(this)}
                    onClick={(ev) => ev.stopPropagation()}
                    onFocus={(ev) => ev.stopPropagation()}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position='end'>
                          <Search />
                        </InputAdornment>
                      ),
                    }}
                    placeholder='Filtertext'
                    style={{ marginLeft: 'auto', minWidth: '5%', maxWidth: '22%' }}
                    color='secondary'
                  /> */}
                </ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.paper}>
                  {this.displayGlobalEvents(this.state.globalEventTrail)}
                </ExpansionPanelDetails>
              </ExpansionPanel>

            </div>{/* Padding for dialog */}
            <div style={{ flexGrow: 1 }} />
            <ClickableFooter
              clearAllAssets={this.clearAllAssets.bind(this)}
              clearAllLogs={this.clearAllLogs.bind(this)}
              updateBackendConfig={this.updateBackendConfig.bind(this)}
              updateFrontendConfig={this.updateFrontendConfig.bind(this)}
              config={this.state.config}
              backendConfig={this.state.backendConfig}
              handleGetConfig={this.getBackendConfig.bind(this)}
              handleSetConfig={this.setBackendConfig.bind(this)}
              handleUpdateTrail={this.updateGlobalEventTrail.bind(this)}
              saveToFile={this.saveToFile.bind(this)}
              handleLoadFromFile={this.loadFromFile.bind(this)}
              license={pjson.license}
              version={pjson.version}
              bigLogo={this.state.bigLogo}
            />
          </div>
        </MuiThemeProvider>
      </React.Fragment>
    );
  }

  /**
   * Checks whether the specified object contains a specified property with a specified type
   * (used for JSON validation)
   * @param {object} object - The object that is to be checked
   * @param {string} property - The property that the object needs to contain
   * @param {string} type - The desired type of the property
   * @returns {boolean} true, if the property and type match, false if not
   * @memberof OI4Base
   */
  checkObjectPropertyType(object, property, type) {
    if (typeof object[property] !== 'undefined') {
      if (typeof object[property] === type) { // eslint-disable-line
        return true;
      } else {
        console.log('Object does have property, but its not the correct type');
        return false;
      }
    } else {
      console.log('Object does not have this property');
      return false;
    }
  }

  /**
   * Clears all logs in the Registry backend by calling the API
   * @memberof OI4Base
   */
  clearAllLogs() {
    this.fetch.delete(`/registry/logs`)
      .then(data => {
        console.log(data);
      });
  }

  /**
   * Toggles the theme between light and dark and switches the logos accordingly
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
   */
  displayGlobalEvents(eventArray) {
    const newArray = [];
    for (const items of eventArray) {
      newArray.push({
        number: items.number,
        description: items.description,
        payload: JSON.stringify(items.payload),
      });
    }
    if (Array.isArray(eventArray)) {
      // return <>
      //   <Table>
      //     <TableHead>
      //       <TableRow>
      //         <TableCell key='GlobalEventsOrigin'>
      //           <span style={{ marginRight: '1%' }}>
      //             <Tooltip title="Copy to clipboard">
      //               <IconButton
      //                 size='small'
      //                 color='default'
      //                 onClick={() => {
      //                   navigator.clipboard.writeText(JSON.stringify(eventArray, null, 2)).then(() => {
      //                     this.setState({ copySnackOpen: true });
      //                   });
      //                 }}
      //               >
      //                 <FileCopy />
      //               </IconButton>
      //             </Tooltip>
      //             <Snackbar
      //               open={this.state.copySnackOpen}
      //               anchorOrigin={{
      //                 vertical: 'bottom',
      //                 horizontal: 'center',
      //               }}
      //               onClose={() => { this.setState({ copySnackOpen: false }) }}
      //               autoHideDuration={4000}
      //               message='Saved Global Events to clipboard'
      //               action={
      //                 <>
      //                   <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
      //                     <Close fontSize='small' />
      //                   </IconButton>
      //                 </>
      //               }
      //             />
      //           </span>
      //           Tag-OI4Id</TableCell>
      //         <TableCell key='GlobalEventsNumber'>ErrorCode</TableCell>
      //         <TableCell key='GlobalEventsDesc'>Description</TableCell>
      //         <TableCell key='GlobalEventsPayload'>Payload</TableCell>
      //       </TableRow>
      //     </TableHead>
      //     <TableBody>
      //       {
      //         eventArray.map((events, idx) => {
      //           const [originManu, ...originRest] = events.Tag.split('/');
      //           return <TableRow key={`GlobalEvents-${idx}`}>
      //             <TableCell component="th" scope="row">{`${decodeURIComponent(originManu)}/${originRest.join('/')}`}</TableCell>
      //             <TableCell component="th" scope="row">{events.number}</TableCell>
      //             <TableCell component="th" scope="row">{events.description}</TableCell>
      //             <TableCell component="th" scope="row">{JSON.stringify(events.payload)}</TableCell>
      //           </TableRow>;
      //         })
      //       }
      //     </TableBody>
      //   </Table></>;
      if (eventArray.length !== 0) {
        return (
          <MaterialTable
            columns={[
              { title: "ErrorCode", field: "number", cellStyle: { wordBreak: 'break-all' } },
              { title: "Description", field: "description", cellStyle: { wordBreak: 'break-all' } },
              { title: 'Payload', field: 'payload', cellStyle: { wordBreak: 'break-all' } }
            ]}
            data={newArray}
            title={<span style={{ marginRight: '1%' }}>
              <Tooltip title="Copy to clipboard">
                <IconButton
                  size='small'
                  color='default'
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(eventArray, null, 2)).then(() => {
                      this.setState({ copySnackOpen: true });
                    });
                  }}
                >
                  <FileCopy />
                </IconButton>
              </Tooltip>
              <Snackbar
                open={this.state.copySnackOpen}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'center',
                }}
                onClose={() => { this.setState({ copySnackOpen: false }) }}
                autoHideDuration={4000}
                message='Saved Global Events to clipboard'
                action={
                  <>
                    <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
                      <Close fontSize='small' />
                    </IconButton>
                  </>
                }
              />
            </span>}
          />);
      } else {
        return <h3>No items in audit trail...</h3>
      }
    }
  }

  // UPDATE-FUNCTIONS OF ASSETS AND RESOURCES //
  /**
   * Updates the conformity of the specified asset via the Registry API
   * @param {string} fullTopic - The full topic pointing to the asset
   * @param {string} oi4Id - The oi4Id of the asset
   * @memberof OI4Base
   */
  updateConformity(fullTopic, oi4Id) {
    this.setState({ updatingConformity: true });
    console.log(`Updating Conformity for ${fullTopic} with oi4Id: ${oi4Id}`);
    if (this.state.backendConfig.developmentMode === true) { // If we're in development mode, we retrieve *all* conformity values
      this.fetch.get(`/fullConformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(oi4Id)}`)
        .then(data => {
          this.setState({ updatingConformity: false });
          const jsonData = JSON.parse(data);
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          this.setState({ conformityLookup: confLookup, updatingConformity: false });
        });
    } else { // If not, retrieve only mandatory conformity values
      this.fetch.get(`/conformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(oi4Id)}`)
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

  /**
   * Fetch the devices via the registry API
   * @memberof OI4Base
   */
  updateDevices() {
    this.fetch.get(`/registry/device`)
      .then(data => {
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        const listOfDevices = JSON.parse(JSON.stringify(this.state.listOfDevices));
        let wasUpdated = false;
        for (const oi4Id of Object.keys(jsonData)) {
          // Update auditTrail
          jsonData[oi4Id].eventList = [];
          for (const audits of this.reverse(this.state.globalEventTrail)) {
            if (audits.Tag === oi4Id) {
              jsonData[oi4Id].eventList.push(audits);
            }
          }
          jsonData[oi4Id].eventList = jsonData[oi4Id].eventList.reverse();

          // Update conformity
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
          confLookupLoc[oi4Id] = jsonData[oi4Id].conformityObject;
          if (!(listOfDevices.includes(oi4Id))) {
            // We've got a new item
            listOfDevices.push(oi4Id);
            wasUpdated = true;
          }
        }
        if (wasUpdated) {
          this.setState({ listOfDevices: listOfDevices }); // FIXME: Potentially dangerous
        }
        this.setState({ deviceLookup: jsonData, conformityLookup: confLookupLoc });
      });
  }

  /**
   * Fetch the applications via the registry API
   * @memberof OI4Base
   */
  updateApplications() {
    this.fetch.get(`/registry/application`)
      .then(data => {
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          // Update auditTrail
          jsonData[oi4Id].eventList = [];
          for (const audits of this.reverse(this.state.globalEventTrail)) {
            if (audits.Tag === oi4Id) {
              jsonData[oi4Id].eventList.push(audits);
            }
          }
          jsonData[oi4Id].eventList = jsonData[oi4Id].eventList.reverse();

          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
          confLookupLoc[oi4Id] = jsonData[oi4Id].conformityObject;
        }
        this.setState({ applicationLookup: jsonData, listOfApps: Object.keys(jsonData), conformityLookup: confLookupLoc });
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

  // DELETION //
  /**
   * Clear all Assets of the Registry backend by calling the corresponding API
   * @memberof OI4Base
   */
  clearAllAssets() {
    console.log('Clear all Assets clicked');
    this.fetch.delete(`/registry/assets`)
      .then(data => {
        console.log(data);
      });
  }

  /**
   * Clear an Asset of the Registry backend by calling the corresponding API
   * @param {string} oi4Id - The oi4Id of the Asset that is to be deleted
   * @memberof OI4Base
   */
  clearAssetById(oi4Id) {
    console.log('Clear Asset by Id clicked');
    this.fetch.delete(`/registry/assets/${encodeURIComponent(oi4Id)}`)
      .then(data => {
        console.log(data);
      });
  }

  // API-UPDATES //
  /**
   * Fetch the most recent health of the Registry itself
   * @memberof OI4Base
   */
  updateHealth() {
    this.fetch.get(`/health`)
      .then(data => {
        this.setState({ health: JSON.parse(data) });
      });
  }

  /**
   * Fetch the oi4Id of the Registry itself
   * @memberof OI4Base
   */
  updateOi4Id() {
    this.fetch.get('')
      .then(data => {
        console.log(data);
        this.setState({ oi4Id: JSON.parse(data) });
      });
  }

  // CALLBACKS FOR CLICKABLE FOOTER //
  /**
   * Callback used for state-lifting and updating the backendConfig (setState cannot be called from child-components!)
   * @param {string} configPropertyName - The property that is to be changed in the backendConfig
   * @param {any} newProperty - The new value of the property
   * @memberof OI4Base
   */
  updateBackendConfig(configPropertyName, newProperty) {
    const oldConfigObj = JSON.parse(JSON.stringify(this.state.backendConfig));
    oldConfigObj[configPropertyName] = newProperty;
    this.setState({ backendConfig: oldConfigObj });
  }

  /**
 * Callback used for state-lifting and updating the frontendConfig (setState cannot be called from child-components!)
 * @param {string} configPropertyName - The property that is to be changed in the backendConfig
 * @param {any} newProperty - The new value of the property
 * @memberof OI4Base
 */
  updateFrontendConfig(configPropertyName, newProperty) {
    const oldConfigObj = JSON.parse(JSON.stringify(this.state.config));
    oldConfigObj[configPropertyName] = newProperty;
    this.setState({ config: oldConfigObj });
  }

  /**
   * Updates the Registry backend with the config by calling the corresponding API
   * @memberof OI4Base
   */
  setBackendConfig() {
    const resizedConfig = JSON.parse(JSON.stringify(this.state.backendConfig));
    resizedConfig.logFileSize = this.state.backendConfig.logFileSize * 1000;
    this.fetch.put(`/registry/config`, JSON.stringify(resizedConfig))
      .then(data => {
        console.log(data);
      });
  }

  /**
   * Updates the local copy of the backendConfig by getting it from the corresponding API
   * @memberof OI4Base
   */
  getBackendConfig() {
    this.fetch.get(`/registry/config`)
      .then(data => {
        const regConfData = JSON.parse(data);
        regConfData.logFileSize = (regConfData.logFileSize) / 1000;
        this.setState({ backendConfig: regConfData });
      });
  }

  /**
   * Saves both the frontendConfig and backendConfig to the local file system of the user via browser
   * @memberof OI4Base
   */
  saveToFile() {
    const fullConfigObj = {
      config: this.state.config,
      backendConfig: this.state.backendConfig,
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fullConfigObj));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `configDmp.json`);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  /**
   * Callback used to load a file from the local file system of the user via the browser.
   * Implements basic property/type checks for the loaded json / object.
   * @param {any} e - The event that caused the callback, typically by an <input/> component
   * @memberof OI4Base
   */
  loadFromFile(e) {
    const fileReader = new FileReader();
    fileReader.readAsText(e.target.files[0]);
    fileReader.onload = (evt) => {
      const confObj = JSON.parse(evt.target.result);
      console.log('Old config: Frontend');
      console.log(JSON.parse(JSON.stringify(this.state.config)));
      console.log('Old config: Backend');
      console.log(JSON.parse(JSON.stringify(this.state.backendConfig)));
      console.log('New config');
      console.log(confObj);
      if (!(this.checkObjectPropertyType(confObj.config, 'auditTrailLength', 'number'))) return;
      if (![25, 50, 100, 200, 400].includes(confObj.config.auditTrailLength)) {
        console.log(`${confObj.config.auditTrailLength} not part of auditTrailLength-array`);
        return;
      }
      if (!(this.checkObjectPropertyType(confObj.backendConfig, 'auditLevel', 'string'))) return;
      if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(confObj.backendConfig.auditLevel)) {
        console.log(`${confObj.backendConfig.auditLevel} not part of auditLevel-array`);
        return;
      }
      if (!(this.checkObjectPropertyType(confObj.backendConfig, 'showRegistry', 'boolean'))) return;
      if (!(this.checkObjectPropertyType(confObj.backendConfig, 'logToFile', 'string'))) return;
      if (!['enabled', 'disabled', 'endpoint'].includes(confObj.backendConfig.logToFile)) {
        console.log(`${confObj.backendConfig.logToFile} not part of logToFile-array`);
        return;
      }
      if (!(this.checkObjectPropertyType(confObj.backendConfig, 'logFileSize', 'number'))) return;
      if (![250, 500, 750, 1000, 2000, 3000, 4000, 5000, 7500, 10000].includes(confObj.backendConfig.logFileSize)) {
        console.log(`${confObj.backendConfig.logFileSize} not part of logFileSize-array`);
        return;
      }
      if (!(this.checkObjectPropertyType(confObj.backendConfig, 'developmentMode', 'boolean'))) return;
      this.setState({ config: confObj.config, backendConfig: confObj.backendConfig });
    };
  }

  /**
   * Fetch the most recent event trail from the Registry
   * @memberof OI4Base
   */
  updateGlobalEventTrail() {
    this.fetch.get(`/registry/event/${this.state.config.auditTrailLength}`)
      .then(data => {
        this.setState({ globalEventTrail: JSON.parse(data) });
      });
  }

  // HELPER-FUNCTIONS //
  /**
   * Reverses the order of an Array
   * @param {array} arr
   * @memberof OI4Base
   */
  * reverse(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      yield arr[i];
    }
  }
}

OI4Base.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles, { withTheme: true })(OI4Base);
