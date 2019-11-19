import React from 'react';

import namur0 from './Images/namur_0.png';
import namur1 from './Images/namur_1.png';
import namur2 from './Images/namur_2.png';
import namur3 from './Images/namur_3.png';
import namur4 from './Images/namur_4.png';

import oi4BigLogoLight from './Images/OI4_Logo_complete_color_RGB.png';
import oi4BigLogoDark from './Images/OI4_Logo_complete_white_RGB.png';
import oi4SmallLogoLight from './Images/OI4_Signet_color_RGB.png';
import oi4SmallLogoDark from './Images/OI4_Signet_white_RGB.png';

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
import Grid from '@material-ui/core/Grid';
import Link from '@material-ui/core/Link';
import CssBaseline from '@material-ui/core/CssBaseline';
import CircularProgress from '@material-ui/core/CircularProgress';
import { BrightnessHigh, Brightness3 } from '@material-ui/icons';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import ExpandLessIcon from '@material-ui/icons/ExpandLess';
import RefreshIcon from '@material-ui/icons/Refresh';
import Divider from '@material-ui/core/Divider';

import _ from 'lodash';
import { reject } from 'q';
import { CommonFetch } from './Helper/CommonFetch/index';
import { Typography, Dialog, DialogTitle, DialogContentText, DialogContent, IconButton } from '@material-ui/core';

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
    display: 'flex',
    minHeight: '100vh',
    flexDirection: 'column',
  },
  table: {
  },
  tableInside: {
    padding: theme.spacing(2),
    fontWeight: 100,
    minHeight: '100vh',
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
      dialogOpen: false,
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
        developmentMode: false,
      },
      theme: lightTheme,
      darkActivated: false,
      // TODO: Remove these hardcoded links and replace with relative images...
      smallLogo: oi4SmallLogoLight,
      bigLogo: oi4BigLogoLight,
      namurLookup: {
        NORMAL_0: namur0,
        FAILURE_1: namur1,
        CHECK_FUNCTION_2: namur2,
        OFF_SPEC_3: namur3,
        MAINTENANCE_REQUIRED_4: namur4,
      },
      globalEventTrail: [],
    };

    this.mandatoryResource = {
      application: ['health', 'license', 'licenseText', 'mam', 'profile'],
      device: ['health', 'mam', 'profile'],
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
        this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath, this.state.applicationLookup[oi4Id].appId);
      }
      for (const oi4Id of Object.keys(this.state.deviceLookup)) {
        this.updateConformity(this.state.deviceLookup[oi4Id].fullDevicePath, this.state.deviceLookup[oi4Id].appId);
      }
    },
      2000);
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
                        <TableCell align="right">Expand</TableCell>
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
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].resources.mam.Manufacturer.Text}</TableCell>
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].resources.mam.Model.Text}</TableCell>
                            <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].resources.mam.DeviceClass}</TableCell>
                            <TableCell align="right">{this.displayNamurHealth(this.getHealth(oi4Id, 'application'))}</TableCell>
                            <TableCell align="right">{this.state.applicationLookup[oi4Id].lastMessage}</TableCell>
                            <TableCell align="right">
                              <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>
                            </TableCell>
                            <TableCell align="right">
                              <IconButton size='small' color='default'>
                                {this.displayTableExpansion(oi4Id)}
                              </IconButton>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                              <Collapse
                                className={classes.tableInside}
                                in={this.state.expandedLookup[oi4Id]}
                                timeout='auto'
                                unmountOnExit
                              >
                                <div>
                                  <Grid item xs={12}>
                                    <Grid container justify='space-evenly'>
                                      <div>
                                        <h3>Detailed MasterAssetModel:</h3>
                                        <Paper className={classes.paper}>
                                          {this.ownJsonViewer(this.state.applicationLookup[oi4Id].resources.mam)}
                                        </Paper>
                                      </div>
                                      <div>
                                        <h3>Conformity Validation:
                                          <IconButton size='small' color='default' onClick={() => { this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath, oi4Id) }}>
                                            <RefreshIcon />
                                          </IconButton>
                                        </h3>
                                        <Paper className={classes.paper}>
                                          {this.displayConformity(this.convertConformityToEmoji(this.state.conformityLookup, oi4Id))}
                                        </Paper>
                                      </div>
                                      <div>
                                        <h3>Detailed Health:</h3>
                                        <Paper className={classes.paper}>
                                          {this.detailedHealthViewer(this.getResourceObject(oi4Id, 'health', 'application'))}
                                        </Paper>
                                      </div>
                                    </Grid>
                                  </Grid>
                                  <div>
                                    <h3>Last 3 Events:</h3>
                                    {this.displayEvents(this.state.applicationLookup[oi4Id].eventList, 'local')}
                                  </div>
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
                  <Table stickyHeader className={classes.table}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Manufacturer</TableCell>
                        <TableCell>Model</TableCell>
                        <TableCell>DeviceClass</TableCell>
                        <TableCell>SerialNumber</TableCell>
                        <TableCell align="right">Health</TableCell>
                        <TableCell align="right">Last Message</TableCell>
                        <TableCell align="right">Conformity</TableCell>
                        <TableCell align="right">Expand</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.keys(this.state.deviceLookup).map((oi4Id) => (
                        <React.Fragment>
                          <TableRow
                            key={this.state.deviceLookup[oi4Id].name}
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
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].resources.mam.Manufacturer.Text}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].resources.mam.Model.Text}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].resources.mam.DeviceClass}</TableCell>
                            <TableCell component="th" scope="row">{this.state.deviceLookup[oi4Id].resources.mam.SerialNumber}</TableCell>
                            <TableCell align="right">{this.displayNamurHealth(this.getHealth(oi4Id, 'device'))}</TableCell>
                            <TableCell align="right">{this.state.deviceLookup[oi4Id].lastMessage}</TableCell>
                            <TableCell align="right">
                              <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>
                            </TableCell>
                            <TableCell align="right">
                              <IconButton size='small' color='default'>
                                {this.displayTableExpansion(oi4Id)}
                              </IconButton>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                              <Collapse
                                className={classes.tableInside}
                                in={this.state.expandedLookup[oi4Id]}
                                timeout='auto'
                                unmountOnExit
                              >
                                <div>
                                  <Grid item xs={12}>
                                    <Grid container justify='space-evenly'>
                                      <div>
                                        <h3>Detailed MasterAssetModel:</h3>
                                        <Paper className={classes.paper}>
                                          {this.ownJsonViewer(this.state.deviceLookup[oi4Id].resources.mam)}
                                        </Paper>
                                      </div>
                                      <div>
                                        <h3>Conformity Validation:
                                          <IconButton size='small' color='default' onClick={() => { this.updateConformity(this.state.deviceLookup[oi4Id].fullDevicePath, oi4Id) }}>
                                            <RefreshIcon />
                                          </IconButton>
                                        </h3>
                                        <Paper className={classes.paper}>
                                          {this.displayConformity(this.convertConformityToEmoji(this.state.conformityLookup, oi4Id), 'device')}
                                        </Paper>
                                      </div>
                                      <div>
                                        <h3>Detailed Health:</h3>
                                        <Paper className={classes.paper}>
                                          {this.detailedHealthViewer(this.getResourceObject(oi4Id, 'health', 'device'))}
                                        </Paper>
                                      </div>
                                    </Grid>
                                  </Grid>
                                  <div>
                                    <h3>Originator:</h3>
                                    <Paper className={classes.paper}>
                                      {this.state.deviceLookup[oi4Id].originator}
                                    </Paper>
                                  </div>
                                  <div>
                                    <h3>Last 3 Events:</h3>
                                    {this.displayEvents(this.state.deviceLookup[oi4Id].eventList, 'local')}
                                  </div>
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
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Global Event Trail: ({this.state.globalEventTrail.length} entries)</ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.paper}>
                  {this.displayEvents(this.state.globalEventTrail)}
                </ExpansionPanelDetails>
              </ExpansionPanel>

            </div>
            <div style={{ flexGrow: 1 }} />
            <Dialog
              open={this.state.dialogOpen}
              onClose={() => this.setState({ dialogOpen: false })}
              maxwidth='lg'
            >
              <DialogTitle titleStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src={this.state.bigLogo} alt="OI4Logo2" style={{ textAlign: 'center', maxWidth: '550px', height: 'auto' }} /></DialogTitle>
              <DialogContent>
                <Divider variant='middle' />
                <Typography variant='h5' style={{ textAlign: 'center' }}>Registry Information</Typography>
                <DialogContentText style={{ paddingLeft: '13px', paddingRight: '13px' }}>
                  <p>
                    Be aware to start the Open Industry 4.0 Alliance's Registry as the very first application in the runtime.
                    Otherwise, you might miss information from other applications and devices.
                  </p>
                  <p>
                    The Registry will list all applications and devices, which are communicating in a conform way to Open Industry 4.0 Alliance.
                    It also displays the event trail of all Open Industry 4.0 Alliance events on the message bus.
                  </p>
                  <p>
                    Every recognized asset gets tested for a basic set of compatibility to Open Industry 4.0 Alliance specification. The result will be displayed as one of:
                    <ul>
                      <li>Fully passed all tests for GET/PUB methods and related payload formats: <span role='img' aria-label='ok'>✅</span></li>
                      <li>Partially passed because GET/PUB methods were answered, but related payload was not correct: <span role='img' aria-label='warn'>⚠️</span></li>
                      <li>Failed because mandatory GET methods are not answered: <span role='img' aria-label='nok'>❌</span></li>
                      <li>Not yet tested (neither successful nor fail): <span role='img' aria-label='default'>❔</span></li>
                    </ul>
                  </p>
                  <p>
                    The conformity icon in the header bar is an indication of overall conformity.
                  </p>
                  <p>
                    The refresh button will initiate a new conformity check.
                  </p>
                  {/* <p>If started as the first container, the registry will display all oncoming Applications and Devices, as long as they are OI4-Conform.</p>
                  <p>It will also display the global OI4-Event trail.</p>
                  <p>When onboarding, each asset is tested for a base-set of compatible APIs. The results are displayed in the following form:</p>
                  <p>Fully passed GET/PUB Method and Payload-format of Resource: <span role='img' aria-label='ok'>✅</span></p>
                  <p>Partially passed (GET/PUB Method was answered, but payload was not correct): <span role='img' aria-label='warn'>⚠️</span></p>
                  <p>Failed GET/PUB Method (no answer on Resource topic): <span role='img' aria-label='nok'>❌</span></p>
                  <p>Not yet tested (neither success nor fail): <span role='img' aria-label='default'>❔</span></p>
                  <p>The conformity icon in the header bar is an indication of overall conformity.</p>
                  <p>The refresh button will initiate a new conformity check.</p>
                  <p><b>Copyright (C)</b>: 2019 Hilscher Gesellschaft für Systemautomation mbH</p> */}
                </DialogContentText>
                <Divider variant='middle' />
                <Typography style={{ textAlign: 'center' }} variant='body2'>Copyright (C): 2019 Hilscher Gesellschaft für Systemautomation mbH</Typography>
              </DialogContent>
            </Dialog>
            <Grid container justify='center' style={{ paddingBottom: '10px' }}>
              <Typography>License: BSD License | Version: 0.10.0 |
                <Link
                  color='inherit'
                  onClick={(e) => {
                    e.preventDefault();
                    this.setState({ dialogOpen: true });
                  }}
                >
                  Click for more Information
                </Link></Typography>
            </Grid>
          </div>
        </MuiThemeProvider>
      </React.Fragment>
    );
  }

  handleDetailClick() {

  }

  /**
   * Checks if health is available and returns it, if possible
   */
  getHealth(oi4Id, type = 'application') {
    let lookup;
    if (type === 'application') {
      lookup = this.state.applicationLookup;
    } else if (type === 'device') {
      lookup = this.state.deviceLookup;
    } else {
      return 'wrong type selected';
    }
    if ('health' in lookup[oi4Id].resources) {
      if ('health' in lookup[oi4Id].resources.health) {
        return lookup[oi4Id].resources.health.health;
      }
    }
    return 'err: health string not found in lookup';
  }

  /**
 * Checks if health object is available and returns it, if possible
 */
  getResourceObject(oi4Id, resource, type = 'application') {
    let lookup;
    if (type === 'application') {
      lookup = this.state.applicationLookup;
    } else if (type === 'device') {
      lookup = this.state.deviceLookup;
    } else {
      return 'wrong type selected';
    }
    if (resource in lookup[oi4Id].resources) {
      return lookup[oi4Id].resources[resource];
    }
    return 'err: resource not found in lookup';
  }

  /**
   * Toggle the theme between dark and light mode.
   */
  toggleTheme() {
    if (this.state.darkActivated) {
      this.setState({ darkActivated: false, theme: lightTheme, smallLogo: oi4SmallLogoLight, bigLogo: oi4BigLogoLight });
    } else {
      this.setState({ darkActivated: true, theme: darkTheme, smallLogo: oi4SmallLogoDark, bigLogo: oi4BigLogoDark });
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

  displayTableExpansion(oi4Id) {
    if (!this.state.expandedLookup[oi4Id]) {
      return <ExpandMoreIcon />;
    } else {
      return <ExpandLessIcon />;
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
    if (!(status in this.state.namurLookup)) {
      return "Undefined NamurHealth";
    } else {
      return <img src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
    }
  }

  detailedHealthViewer(healthObject) {
    return <div>
      <div><span style={{ fontWeight: 'bold' }}>NE107 Status:</span>{healthObject.health}({this.displayNamurHealth(healthObject.health, 15, 20)})</div>
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
   * @param {string} assetType - The type of the asset (device/application)
   * @param {object} conformityObject - The conformity object that is to be displayed
   */
  displayConformity(conformityObject, assetType = 'application') {
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
            if (this.mandatoryResource[assetType].includes(resources)) {
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
  updateConformity(fullTopic, appId) {
    console.log(`Updating Conformity for ${fullTopic} with appId: ${appId}`);
    const oi4Id = appId;
    if (this.state.config.developmentMode === true) {
      this.fetch.get(`/fullConformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(appId)}`)
        .then(data => {
          const jsonData = JSON.parse(data);
          const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
          delete confLookup[oi4Id];
          confLookup[oi4Id] = jsonData;
          // console.log(`Fetched conformity for ${oi4Id}: ${JSON.stringify(data)} and updated in ${JSON.stringify(confLookup)}`)
          this.setState({ conformityLookup: confLookup });
        });
    } else {
      this.fetch.get(`/conformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(appId)}`)
        .then(data => {
          const jsonData = JSON.parse(data);
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
        const jsonData = JSON.parse(data);
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          if (this.state.deviceLookup[oi4Id] === undefined || this.state.deviceLookup[oi4Id] === null) {
            const fullTopic = jsonData[oi4Id].fullDevicePath;
            const appId = jsonData[oi4Id].appId;
            this.updateConformity(fullTopic, appId);
          }
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
        }
        this.setState({ deviceLookup: jsonData, confLookup: confLookupLoc });
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
            const appId = jsonData[oi4Id].appId;
            this.updateConformity(fullTopic, appId);
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
              // console.log(`Cockpit-Only for Resource ${resource}:`);
              // console.log(data);
              const resourceObject = JSON.parse(data);
              // TODO: Remove everything except setState and update function!
              const applicationLookupLoc = JSON.parse(JSON.stringify(this.state.applicationLookup));
              if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                if ('err' in resourceObject) {
                  console.log(`Received Error in updateRegistryResource (${resource})`);
                  console.log(resourceObject);
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
