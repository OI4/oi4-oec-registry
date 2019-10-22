import React from 'react';
// import logo from './logo.svg';
import { MuiThemeProvider, createMuiTheme, withStyles } from '@material-ui/core/styles';
import PropTypes from 'prop-types';
import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Collapse from '@material-ui/core/Collapse';
import Paper from '@material-ui/core/Paper';
import Checkbox from '@material-ui/core/Checkbox';
import Toolbar from '@material-ui/core/Toolbar';
import AppBar from '@material-ui/core/AppBar';
// import Button from '@material-ui/core/Button';
import Fab from '@material-ui/core/Fab';
import CssBaseline from '@material-ui/core/CssBaseline';
import CircularProgress from '@material-ui/core/CircularProgress';
import { BrightnessHigh, Brightness3 } from '@material-ui/icons';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import RefreshIcon from '@material-ui/icons/Refresh';

import _ from 'lodash';
import { reject } from 'q';
import { CommonFetch } from './Helper/CommonFetch/index';
import { Typography } from '@material-ui/core';

const darkTheme = createMuiTheme({
  palette: {
    type: 'dark',
  },
});

const lightTheme = createMuiTheme({
  palette: {

  }
});

const styles = theme => ({
  root: {
    // padding: theme.spacing(4),
    paddingLeft: '120px',
    paddingRight: '120px',
  },
  table: {
  },
  tableInside: {
    padding: theme.spacing(2),
    fontWeight: 100,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'calc(5px + 1vmin)',
  },
  paper: {
    padding: theme.spacing(2),
    marginTop: theme.spacing(3),
    width: '100%',
    overflowX: 'auto',
    marginBottom: theme.spacing(2),
  },
  toolbarStyle: {
    backgroundColor: 'grey',
  },
});

class OI4Base extends React.Component {
  constructor(props) {
    super(props);

    // The following lines will give access to the external Endpoint for the REST API defined by the Environment variables.
    // This way, the registry backend is fully decoupled from the front-end
    /* eslint-disable */
    if (typeof serviceEndpoint === 'object' && serviceEndpoint !== null) {
      this.address = serviceEndpoint.address;
      this.port = serviceEndpoint.port;
    }
    // Since Cockpit uses a different approach to fetch data, we introduced a common API, which can be accessed by both
    // the local UI and the cockpit frontend.
    // Change the first argument to either 'fetch' or 'cockpit' depending on your use-case!
    this.fetch = new CommonFetch('cockpit', this.address, this.port);
    /* eslint-enable */

    this.state = {
      appId: 'empty',
      applicationLookup: {},
      deviceLookup: {},
      expandBoxes: {},
      expandedLookup: {},
      direction: true,
      loadValue: 0,
      conformityLookup: {},
      validityLookup: {
        0: '❔',
        1: '✅',
        2: '⚠️',
        3: '❌',
      },
      footerExpanded: false,
      config: {
        developmentMode: true,
      },
      theme: lightTheme,
      darkActivated: false,
      // TODO: Remove these hardcoded links and replace with relative images...
      iconSource: 'https://i.imgur.com/LBYpKg3.png',
      namurLookup: [
        'https://i.imgur.com/hHYbbn5.png',
        'https://i.imgur.com/jLS12vP.png',
        'https://i.imgur.com/saz6aWA.png',
        'https://i.imgur.com/kUQ0wLJ.png',
        'https://i.imgur.com/8FXxfIq.png',
      ],
      globalEventTrail: [],
    };

    this.mandatoryResource = ['health', 'license', 'licenseText', 'mam', 'profile'];
    this.namurEnum = {
      0: 'NORMAL_0',
      1: 'FAILURE_1',
      2: 'CHECK_FUNCTION_2',
      3: 'OFF_SPEC_3',
      4: 'MAINTENANCE_REQUIRED_4',
    };
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.activeIntervals = [];

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
    setTimeout(() => {
      for (const oi4Id of Object.keys(this.state.applicationLookup)) {
        this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath);
      }
    },
      3000);
    this.updateAppID(); // This will retrieve the AppID of the registry itself.
    setTimeout(() => {
      this.toggleTheme();
    },
      100);
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
            <AppBar position="static" color='inherit'>
              <Toolbar>
                <img src={this.state.iconSource} alt="OI4Logo" height="55" width="55" style={{ marginRight: '10px' }} />
                <Typography variant='h6' style={{ flexGrow: 1 }}>OI4 Registry</Typography>
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
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Application Registry: ({Object.keys(this.state.applicationLookup).length} entries)</ExpansionPanelSummary>
                <ExpansionPanelDetails>
                  <Table stickyHeader className={classes.table}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Manufacturer</TableCell>
                        <TableCell>Model</TableCell>
                        <TableCell>DeviceClass</TableCell>
                        <TableCell align="right">Health</TableCell>
                        <TableCell align="right">Last Message</TableCell>
                        <TableCell align="right">Conformity</TableCell>
                        <TableCell align="right">Refresh</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.keys(this.state.applicationLookup).map((oi4Id) => (
                        <React.Fragment>
                          <TableRow
                            key={this.state.applicationLookup[oi4Id].name}
                            hoverstyle={{ cursor: "pointer" }}
                            onClick={() => {
                              // A bit of a hack in order to not mutate the state...
                              const expandedLookupCopy = JSON.parse(JSON.stringify(this.state.expandedLookup));
                              if (oi4Id in expandedLookupCopy) {
                                expandedLookupCopy[oi4Id] = !(expandedLookupCopy[oi4Id]);
                              } else {
                                expandedLookupCopy[oi4Id] = true;
                              }
                              this.setState({ expandedLookup: expandedLookupCopy });
                            }}
                          >
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].Manufacturer}</TableCell>
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].Model}</TableCell>
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].DeviceClass}</TableCell>
                            <TableCell align="right">{this.displayNamurHealth(this.state.applicationLookup[oi4Id].health.health)}</TableCell>
                            <TableCell align="right">{this.state.applicationLookup[oi4Id].lastMessage}</TableCell>
                            <TableCell align="right">
                              <span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <Fab size="small" color="default" onClick={() => { this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath) }}>
                                <RefreshIcon />
                              </Fab>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                              <Collapse
                                className={classes.tableInside}
                                in={this.state.expandedLookup[oi4Id]}
                                timeout="auto"
                                unmountOnExit
                              >
                                <h3>Detailed MasterAssetModel:</h3>
                                <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                  {this.ownJsonViewer(this.state.applicationLookup[oi4Id].mam)}
                                </Paper>
                                <h3>Detailed Health:</h3>
                                <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                  {this.detailedHealthViewer(this.state.applicationLookup[oi4Id].health)}
                                </Paper>
                                <div>
                                  <h3>Basic Conformance Validation:</h3>
                                  <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                    {this.displayConformity(this.convertConformityToEmoji(this.state.conformityLookup, oi4Id))}
                                  </Paper>
                                </div>
                                <div>
                                  <h3>Last 3 Events:</h3>
                                  {this.displayEvents(this.state.applicationLookup[oi4Id].eventList, 'local')}
                                </div>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </ExpansionPanelDetails>
              </ExpansionPanel>
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Device Registry: ({Object.keys(this.state.deviceLookup).length} entries)</ExpansionPanelSummary>
                <ExpansionPanelDetails>
                  <Table className={classes.table}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Manufacturer</TableCell>
                        <TableCell>Model</TableCell>
                        <TableCell>DeviceClass</TableCell>
                        <TableCell>SerialNumber</TableCell>
                        <TableCell>Origin</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.keys(this.state.deviceLookup).map((oi4Id) => (
                        <React.Fragment>
                          <TableRow key={this.state.deviceLookup[oi4Id].name}>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].Manufacturer}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].Model}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].DeviceClass}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].SerialNumber}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].originator}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={5} />
                          </TableRow>
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </ExpansionPanelDetails>
              </ExpansionPanel>
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Global Event Trail: ({this.state.globalEventTrail.length} entries)</ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.paper}>
                  {this.displayEvents(this.state.globalEventTrail)}
                </ExpansionPanelDetails>
              </ExpansionPanel>
              <Collapse
                style={{ backgroundColor: this.state.theme.palette.background.paper, position: 'fixed', width: '87.4%', bottom: '21px', border: '3px', borderColor: 'black' }}
                className={classes.paper}
                in={this.state.footerExpanded}
                timeout="auto"
                unmountOnExit
              >
                <p>If started as the first container, the registry will display all oncoming Applications and Devices, as long as they are OI4-Conform.</p>
                <p>It will also display the global OI4-Event trail.</p>
                <p>When onboarding, each asset is tested for a base-set of compatible APIs. The results are displayed in the following form:</p>
                <p>Fully passed GET/PUB Method and Payload-format of Resource: <span role='img' aria-label='ok'>✅</span></p>
                <p>Partially passed (GET/PUB Method was answered, but payload was not correct): <span role='img' aria-label='warn'>⚠️</span></p>
                <p>Failed GET/PUB Method (no answer on Resource topic): <span role='img' aria-label='nok'>❌</span></p>
                <p>Not yet tested (neither success nor fail): <span role='img' aria-label='default'>❔</span></p>
                <p>The conformity icon in the header bar is an indication of overall conformity.</p>
                <p>The refresh button will initiate a new conformity check.</p>
                <p><b>License</b>: BSD, <b>Copyright (C)</b>: 2019 Hilscher Gesellschaft für Systemautomation mbH, <b>Version</b>: v0.8-1</p>
              </Collapse>
              <ExpansionPanel style={{ position: 'fixed', bottom: 1, width: '87.4%' }}>
                <ExpansionPanelSummary
                  onClick={() => {
                    this.setState({ footerExpanded: !this.state.footerExpanded });
                  }}
                  expandIcon={<ExpandLessIcon />}
                >
                  Additional Information
                </ExpansionPanelSummary>
              </ExpansionPanel>
            </div>
          </div>
        </MuiThemeProvider>
      </React.Fragment>
    );
  }

  /**
   * Toggle the theme between dark and light mode.
   */
  toggleTheme() {
    if (this.state.darkActivated) {
      this.setState({ darkActivated: false, theme: lightTheme, iconSource: 'https://i.imgur.com/LBYpKg3.png' });
    } else {
      this.setState({ darkActivated: true, theme: darkTheme, iconSource: 'https://i.imgur.com/7gAhh6X.png' });
    }
  }

  /**
   * This function avoids errors by first checking if a property exists
   * and then returning that property. If a property does not exist, a string will be displayed instead.
   * @param {object} object - any object that will (does not) contain the prop
   * @param {string} prop - any property of the object
   */
  displayObjectProp(object, prop) {
    if (typeof object === 'object' && object !== null) {
      if (prop in object) {
        return object[prop];
      } else {
        return `Fetching ${prop}`;
      }
    }
  }

  displayConformityHeader(oi4Id) {
    if (this.state.conformityLookup[oi4Id]) {
      return this.state.validityLookup[this.state.conformityLookup[oi4Id].validity];
    } else {
      return 'Wait...';
    }
  }

  displayNamurHealth(status, height = '25', width = '30') {
    if (status < 0 || status > 5) {
      return "Undefined NamurHealth";
    }
    return <img src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
  }

  detailedHealthViewer(healthObject) {
    return <div>
      <div><span style={{ fontWeight: 'bold' }}>NE107 Status:</span>{this.namurEnum[healthObject.health]}({this.displayNamurHealth(healthObject.health, 15, 20)})</div>
      <div><span style={{ fontWeight: 'bold' }}>Health state[%]:</span>{healthObject.healthState}</div>
    </div>;
  }

  /**
   * Displays a JSON-Object in a relatively simple manner by recursing over the object
   * @param {object} jsonObject - the object that is to be displayed
   * @param {number} idx - the depthLevel that we are displaying with the viewer
   */
  ownJsonViewer(jsonObject, idx = 0) {
    if (typeof jsonObject === 'object' && jsonObject !== null) {
      return Object.keys(jsonObject).map((keys) => {
        if (typeof jsonObject[keys] === 'object' && jsonObject[keys] !== null) {
          return <div style={{ marginLeft: idx * 25 }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div style={{ marginLeft: idx * 25 }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {jsonObject[keys].toString()}</div>;
        }
      });
    } else if (Array.isArray(jsonObject)) {
      return jsonObject.map((keys) => {
        if (typeof jsonObject[keys] === 'object' && jsonObject[keys] !== null) {
          return <div style={{ marginLeft: idx * 25 }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div style={{ marginLeft: idx * 25 }}><span style={{ fontWeight: 'bold' }}>{keys}</span>: {'Test'}</div>;
        }
      });
    } else {
      return <CircularProgress />;
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
              <TableCell>OriginID</TableCell>
              <TableCell>Number</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Payload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {
              eventArray.map((events) => {
                return <TableRow>
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
              eventArray.map((events) => {
                return <TableRow>
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

  /**
   * Converts a conformity Object to a displayable fashion and displays
   * all conformity values (ok, partial, nok) in a table
   * @param {object} conformityObject - The conformity object that is to be displayed
   */
  displayConformity(conformityObject) {
    if (typeof conformityObject === 'object' && conformityObject !== null) {
      return <div>
        <b>OI4-Id Conformity: </b>{conformityObject.oi4Id}
        {
          Object.keys(conformityObject.resource).map((resources) => {
            let resourceColor = this.state.theme.palette.text.default;
            let resourceWeight = 400;
            if (conformityObject.nonProfileResourceList.includes(resources)) {
              resourceColor = this.state.theme.palette.secondary.light;
            }
            if (this.mandatoryResource.includes(resources)) {
              resourceWeight = 600;
            }
            if (conformityObject.resource[resources].validityError) {
              return <div style={{ fontWeight: resourceWeight, color: resourceColor }}>{resources}:{conformityObject.resource[resources].validity}, Error: {conformityObject.resource[resources].validityError}</div>;
            } else {
              return <div style={{ fontWeight: resourceWeight, color: resourceColor }}>{resources}:{conformityObject.resource[resources].validity}</div>;
            }
          })
        }
      </div>;
    }
  }

  // -- CONFORMITY HELPERS
  updateConformity(fullTopic) {
    console.log(`Updating Conformity for ${fullTopic}`);
    if (this.state.config.developmentMode === true) {
      this.fetch.get(`/fullConformity/${encodeURIComponent(fullTopic)}`)
        .then(data => {
          const jsonData = JSON.parse(data);
          const topicArray = fullTopic.split('/');
          const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          // console.log(`Fetched conformity for ${oi4Id}: ${JSON.stringify(data)} and updated in ${JSON.stringify(confLookup)}`)
          this.setState({ conformityLookup: confLookup });
        });
    } else {
      this.fetch.get(`/conformity/${encodeURIComponent(fullTopic)}`)
        .then(data => {
          const jsonData = JSON.parse(data);
          const topicArray = fullTopic.split('/');
          const oi4Id = `${topicArray[2]}/${topicArray[3]}/${topicArray[4]}/${topicArray[5]}`;
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          // console.log(`Fetched conformity for ${oi4Id}: ${JSON.stringify(data)} and updated in ${JSON.stringify(confLookup)}`)
          this.setState({ conformityLookup: confLookup });
        });
    }
  }

  convertConformityToEmoji(conformityObject, oi4Id) {
    const conformityObj = JSON.parse(JSON.stringify(conformityObject));
    const validityLookup = this.state.validityLookup;
    if (oi4Id in conformityObject) {
      conformityObj[oi4Id].oi4Id = validityLookup[conformityObject[oi4Id].oi4Id];
      conformityObj[oi4Id].validity = validityLookup[conformityObject[oi4Id].validity];
      Object.keys(conformityObject[oi4Id].resource).forEach((resource) => {
        conformityObj[oi4Id].resource[resource].validity = validityLookup[conformityObject[oi4Id].resource[resource].validity];
      });
      return conformityObj[oi4Id];
    } else {
      return 'ERROR';
    }
  }

  // UPDATE HELPERS
  updateDevices() {
    this.fetch.get(`/registry/device`)
      .then(data => {
        this.setState({ deviceLookup: JSON.parse(data) });
      });
  }

  /**
   * Fetch the most recent applicationlookup by the registry
   */
  updateApplications() {
    this.fetch.get(`/registry/application`)
      .then(data => {
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          if (this.state.applicationLookup[oi4Id] === undefined || this.state.applicationLookup[oi4Id] === null) {
            const fullTopic = jsonData[oi4Id].fullDevicePath;
            this.updateConformity(fullTopic);
          }
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
        }
        this.setState({ applicationLookup: jsonData, confLookup: confLookupLoc });
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
                applicationLookupLoc[oi4Id][resource] = resourceObject;
              }
              this.setState({ applicationLookup: applicationLookupLoc });
            })
            .catch(err => {
              // console.log(`Error ${err} with Resource ${resource}`);
              reject(err);
            });
        } else { // If we don't have it in our lookup, we can return!
          if (this.state.conformityLookup[oi4Id].resource[resource].validity !== 0) {
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

  updateHealth() {
    this.fetch.get(`/health`)
      .then(data => {
        this.setState({ health: JSON.parse(data) });
      });
  }

  updateConfig() {
    this.fetch.get(`/config`)
      .then(data => {
        this.setState({ config: JSON.parse(data) });
      });
  }

  updateAppID() {
    this.fetch.get('')
      .then(data => {
        console.log(data);
        this.setState({ appId: JSON.parse(data) });
      });
  }

  updateGlobalEventTrail() {
    this.fetch.get(`/registry/event`)
      .then(data => {
        this.setState({ globalEventTrail: JSON.parse(data) });
      });
  }

  // SETTERS
  setConfig(newConfig) { // eslint-disable-line no-unused-vars
    // TODO!
  }
}

OI4Base.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles, { withTheme: true })(OI4Base);
