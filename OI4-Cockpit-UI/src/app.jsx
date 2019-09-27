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
import Button from '@material-ui/core/Button';
import CssBaseline from '@material-ui/core/CssBaseline';
import CircularProgress from '@material-ui/core/CircularProgress';
import { BrightnessHigh, BrightnessLow, AddCircle } from '@material-ui/icons';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import _ from 'lodash';
import { reject } from 'q';
import { CommonFetch } from './Helper/CommonFetch/index';

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
    minWidth: 350,
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

const EDeviceHealth = {
  NORMAL_0: 0,
  FAILURE_1: 1,
  CHECK_FUNCTION_2: 2,
  OFF_SPEC_3: 3,
  MAINTENANCE_REQUIRED_4: 4,
};

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
        ok: 0,
        partial: 1,
        nok: 2,
      },
      updateLookup: {

      },
      config: {
        textColor: 'white',
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
      globalAuditTrail: [],
    };

    this.mandatoryResource = ['health', 'license', 'licenseText', 'mam', 'profile'];

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
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('config') }, 8200));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('rtLicense') }, 8300));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('license') }, 8400));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('auditList') }, 8500));
    this.activeIntervals.push(setInterval(() => { this.updateRegistryResource('profile') }, 8600));
    this.activeIntervals.push(setInterval(() => { this.updateGlobalAuditTrail() }, 10000));

    // If we start out with a couple of applications, we should update their conformity right away
    setTimeout(() => {
      for (const oi4Id of Object.keys(this.state.applicationLookup)) {
        this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath);
      }
    },
      3000);
    this.updateAppID(); // This will retrieve the AppID of the registry itself.
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
            <AppBar position="static" color='inherit'><Toolbar><img src={this.state.iconSource} alt="OI4Logo" height="55" width="55" /><h3 style={{ marginLeft: this.state.theme.spacing(2) }}>OI4-Registry</h3></Toolbar></AppBar>
            <div>
              <span>
                <h1>
                  Hello! This is an OI4-compatible Registry:
                  <Checkbox
                    icon={<BrightnessHigh />}
                    checkedIcon={<BrightnessLow />}
                    checked={this.state.darkActivated}
                    onChange={() => { this.toggleTheme() }}
                  />
                </h1>
              </span>
              <Paper className={classes.paper}>
                If started as the first container, it will register and display all oncoming Applications and Devices that are OI4-conform.
                Every container/device in the registry is polled in an interval about their Stats (Health, Resource, etc.)<br />
                When onboarding, each container is tested for a base-set of compatible APIs. The results are displayed in following form:<br />
                <p>
                  Fully passed base-set of OI4-Functions: <span role="img" aria-label="check">✅</span><br />
                  Partially passed base-set of OI4-Functions: <span role="img" aria-label="semicheck">⚠️</span><br />
                  Failed base-set of OI4-Functions: <span role="img" aria-label="failcheck">❌</span>
                </p>
              </Paper>
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Application Registry: </ExpansionPanelSummary>
                <ExpansionPanelDetails>
                  <Paper className={classes.paper}>
                    <Table className={classes.table}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Manufacturer</TableCell>
                          <TableCell>Model</TableCell>
                          <TableCell>DeviceClass</TableCell>
                          <TableCell align="right">Health</TableCell>
                          <TableCell align="right">Last Message</TableCell>
                          <TableCell align="right">Conformity</TableCell>
                          <TableCell align="right">Updated</TableCell>
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
                                const updateLookupLoc = JSON.parse(JSON.stringify(this.state.updateLookup));
                                updateLookupLoc[oi4Id] = false;
                                this.setState({ expandedLookup: expandedLookupCopy, updateLookup: updateLookupLoc });
                              }}
                            >
                              <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].Manufacturer}</TableCell>
                              <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].Model}</TableCell>
                              <TableCell component="th" scope="row">{this.state.applicationLookup[oi4Id].DeviceClass}</TableCell>
                              <TableCell align="right">{this.displayNamurHealth(this.state.applicationLookup[oi4Id].health.health)}</TableCell>
                              <TableCell align="right">{this.state.applicationLookup[oi4Id].health.lastMessage}</TableCell>
                              <TableCell align="right">
                                <Button variant="contained" size="small" color="default" onClick={() => { this.updateConformity(this.state.applicationLookup[oi4Id].fullDevicePath) }}>
                                  Refresh
                                  <span role="img" aria-label="check">{this.parseConformityData(this.state.conformityLookup, oi4Id)}</span>
                                </Button>
                              </TableCell>
                              <TableCell align="right">{this.displayUpdate(oi4Id)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={5}>
                                <Collapse
                                  className={classes.tableInside}
                                  in={this.state.expandedLookup[oi4Id]}
                                  timeout="auto"
                                  unmountOnExit
                                >
                                  <h3>Detailed Health:</h3>
                                  <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                    {this.ownJsonViewer(this.state.applicationLookup[oi4Id].health)}
                                  </Paper>
                                  <div>
                                    <h3>Basic Conformance Validation:</h3>
                                    <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                      {this.displayConformity(this.convertConformityToEmoji(this.state.conformityLookup, oi4Id))}
                                    </Paper>
                                  </div>
                                  <div>
                                    <h3>Last 3 Audits:</h3>
                                    <Paper className={classes.paper} style={{ maxWidth: 700 }}>
                                      {this.displayAudits(this.state.applicationLookup[oi4Id].auditList)}
                                    </Paper>
                                  </div>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </React.Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                </ExpansionPanelDetails>
              </ExpansionPanel>
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Device Registry: </ExpansionPanelSummary>
                <ExpansionPanelDetails>
                  <Paper className={classes.paper}>
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
                  </Paper>
                </ExpansionPanelDetails>
              </ExpansionPanel>
              <ExpansionPanel>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}> Global Audit Trail: </ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.paper}>
                  {this.displayAudits(this.state.globalAuditTrail)}
                </ExpansionPanelDetails>
              </ExpansionPanel>
              {/* <div>
                <h2>
                  DEBUG - Own health:
                </h2>
                <Paper className={classes.paper}>
                  {this.ownJsonViewer(this.state.health)}
                </Paper>
              </div>
              <div>
                <Paper className={classes.paper}>
                  <h2>DEBUG - Own Config (Try to edit this!):</h2><JsonTree data={this.state.config} onFullyUpdate={(data) => { this.setConfig(data); }} />
                  <h1 style={{ color: this.state.config.textColor }}>This text is written in the color configured in the Container-Backend</h1>
                </Paper>
              </div> */}
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

  /**
   * Returns a "plus" sign whenever an update was triggered to indicate
   * that there might be new data in the expanded panel
   * @param {string} oi4Id - oi4Id of the application that is looked up in the updateList
   */
  displayUpdate(oi4Id) {
    if (this.state.updateLookup[oi4Id]) {
      return <AddCircle style={{ color: this.state.theme.palette.secondary.dark }} />;
    } else {
      return <AddCircle style={{ color: 'grey' }} />;
    }
  }

  displayNamurHealth(status) {
    return <img src={this.state.namurLookup[status]} alt="Namur" height="25" width="30" />;
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
          return <div style={{ marginLeft: idx * 25 }}><b>{keys}</b>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div style={{ marginLeft: idx * 25 }}><b>{keys}</b>: {jsonObject[keys].toString()}</div>;
        }
      });
    } else if (Array.isArray(jsonObject)) {
      return jsonObject.map((keys) => {
        if (typeof jsonObject[keys] === 'object' && jsonObject[keys] !== null) {
          return <div style={{ marginLeft: idx * 25 }}><b>{keys}</b>: {this.ownJsonViewer(jsonObject[keys], idx + 1)}</div>;
        } else {
          return <div style={{ marginLeft: idx * 25 }}><b>{keys}</b>: {'Test'}</div>;
        }
      });
    } else {
      return <CircularProgress />;
    }
  }

  /**
   * Displays the time of the health object.
   * If the health is good, displays registeredAt
   * If it is bad, displays lastMessage
   * @param {object} healthObject - the health that is to be parsed for the timeData
   */
  displayTime(healthObject) {
    if (typeof healthObject === 'object' && healthObject !== null) {
      if (healthObject.health === EDeviceHealth.NORMAL_0) {
        return <b>Registered at:{healthObject.registeredAt}</b>;
      } else if (healthObject.health === EDeviceHealth.FAILURE_1) {
        return <b>Last Message:{healthObject.lastMessage}</b>;
      }
    }
  }

  /**
   * Displays the Audits / Events coming from either global or local data sources
   * @param {array} auditArray - an array of the last few audits
   */
  displayAudits(auditArray) {
    if (Array.isArray(auditArray)) {
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
            auditArray.map((audits) => {
              return <TableRow>
                <TableCell component="th" scope="row">{audits.originId}</TableCell>
                <TableCell component="th" scope="row">{audits.number}</TableCell>
                <TableCell component="th" scope="row">{audits.description}</TableCell>
                <TableCell component="th" scope="row">{JSON.stringify(audits.payload)}</TableCell>
              </TableRow>;
            })
          }
        </TableBody>
      </Table>;
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
        <b>OI4-Id Conformity: </b>: {conformityObject.oi4Id}
        {
          Object.keys(conformityObject.resource).map((resources) => {
            if (this.mandatoryResource.includes(resources)) {
              return <div>{resources}:(
                {
                  Object.keys(conformityObject.resource[resources].method).map((methods) => {
                    return <b>{methods}: {conformityObject.resource[resources].method[methods]}</b>;
                  })
                })
                </div>;
            } else {
              return <div style={{ color: 'lightgrey' }}>{resources}:(
                {
                  Object.keys(conformityObject.resource[resources].method).map((methods) => {
                    return <b>{methods}: {conformityObject.resource[resources].method[methods]}</b>;
                  })
                })
                </div>;
            }
          })
        }
      </div>;
    }
  }

  // -- CONFORMITY HELPERS
  updateConformity(fullTopic) {
    console.log(`Updating Conformity for ${fullTopic}`);
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

  /**
   * Converts the conformity test results (ok, partial, nok) to emojis in order to display them
   * in the front-end
   * @param {object} conformityObject - the object that is to be converted
   * @param {string} oi4Id - the oi4id where there results are saved at
   */
  parseConformityData(conformityObject, oi4Id) {
    if (oi4Id in conformityObject) {
      switch (conformityObject[oi4Id].validity) {
        case this.state.validityLookup.ok: {
          return '✅';
        }
        case this.state.validityLookup.partial: {
          return '⚠️';
        }
        case this.state.validityLookup.nok: {
          return '❌';
        }
        default: {
          return 'ERROR';
        }
      }
    } else {
      return 'ing...';
    }
  }

  convertNumToEmoji(num) {
    if (num === 0) return '✅';
    if (num === 1) return '⚠️';
    if (num === 2) return '❌';
    return 'ERROR';
  }

  convertConformityToEmoji(conformityObject, oi4Id) {
    const conformityObj = JSON.parse(JSON.stringify(conformityObject));
    if (oi4Id in conformityObject) {
      conformityObj[oi4Id].oi4Id = this.convertNumToEmoji(conformityObject[oi4Id].oi4Id);
      conformityObj[oi4Id].validity = this.convertNumToEmoji(conformityObject[oi4Id].validity);
      Object.keys(conformityObject[oi4Id].resource).forEach((resource) => {
        conformityObj[oi4Id].resource[resource].validity = this.convertNumToEmoji(conformityObject[oi4Id].resource[resource].validity);
        Object.keys(conformityObject[oi4Id].resource[resource].method).forEach((method) => {
          conformityObj[oi4Id].resource[resource].method[method] = this.convertNumToEmoji(conformityObject[oi4Id].resource[resource].method[method]);
        });
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
        const updateLookupLoc = JSON.parse(JSON.stringify(this.state.updateLookup));
        const confLookupLoc = JSON.parse(JSON.stringify(this.state.conformityLookup));
        for (const oi4Id of Object.keys(jsonData)) {
          if (this.state.applicationLookup[oi4Id] === undefined || this.state.applicationLookup[oi4Id] === null) {
            updateLookupLoc[oi4Id] = true;
            const fullTopic = jsonData[oi4Id].fullDevicePath;
            this.updateConformity(fullTopic);
          }
          if (oi4Id in confLookupLoc) {
            delete confLookupLoc[oi4Id];
          }
        }
        this.setState({ applicationLookup: jsonData, updateLookup: updateLookupLoc, confLookup: confLookupLoc });
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
        if (resource === 'auditList') {
          this.fetch.get(`/registry/${resource}/${encodeURIComponent(oi4Id)}`)
            .then(data => {
              const resourceObject = JSON.parse(data);
              // TODO: Remove everything except setState and update function!
              const applicationLookupLoc = JSON.parse(JSON.stringify(this.state.applicationLookup));
              const updateLookupLoc = JSON.parse(JSON.stringify(this.state.updateLookup));
              if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                if (!this.state.expandedLookup[oi4Id]) {
                  updateLookupLoc[oi4Id] = true;
                }
                applicationLookupLoc[oi4Id][resource] = resourceObject;
              }
              this.setState({ applicationLookup: applicationLookupLoc, updateLookup: updateLookupLoc });
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
              const updateLookupLoc = JSON.parse(JSON.stringify(this.state.updateLookup));
              if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                if (!this.state.expandedLookup[oi4Id]) {
                  updateLookupLoc[oi4Id] = true;
                }
                applicationLookupLoc[oi4Id][resource] = resourceObject;
              }
              this.setState({ applicationLookup: applicationLookupLoc, updateLookup: updateLookupLoc });
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

  updateGlobalAuditTrail() {
    this.fetch.get(`/registry/audit`)
      .then(data => {
        this.setState({ globalAuditTrail: JSON.parse(data) });
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
