/* eslint-disable react/jsx-first-prop-new-line */
import React from 'react';

// Import images

// OI4-Logos
// import oi4BigLogoLight from './Images/OI4_Logo_complete_color_RGB.png';
// import oi4BigLogoDark from './Images/OI4_Logo_complete_white_RGB.png';
import oi4BigLogoLight from './Images/OI4_Badge_Full_Color_Community.png';
// import oi4BigLogoDark from './Images/OI4_Badge_Green_Community.png';
import oi4BigLogoDark from './Images/OI4_Badge_Transparent_Community_Beta.png';
import oi4SmallLogoLight from './Images/OI4_Signet_color_RGB.png';
import oi4SmallLogoDark from './Images/OI4_Signet_white_RGB.png';

import namur_normal_0 from './Images/namur_normal_0.png';
import namur_failure_1 from './Images/namur_failure_1.png';
import namur_off_spec_3 from './Images/namur_off_spec_3.png';

import { MuiThemeProvider, createTheme, withStyles } from '@material-ui/core/styles';
import PropTypes from 'prop-types';

import Checkbox from '@material-ui/core/Checkbox';
import Toolbar from '@material-ui/core/Toolbar';
import AppBar from '@material-ui/core/AppBar';

import MaterialTable from 'material-table';

import winston from 'winston';

import {
    Typography,
    Accordion,
    AccordionDetails,
    AccordionSummary,
    IconButton,
    Snackbar,
    Tooltip,
} from '@material-ui/core';

import CssBaseline from '@material-ui/core/CssBaseline';
import {
    BrightnessHigh,
    Brightness3,
    ExpandMore,
    FileCopy,
    Close,
} from '@material-ui/icons';

import _ from 'lodash';
import { reject } from 'q';
import { CommonFetch } from './Helper/CommonFetch/index.js';

// Import custom components
import { ClickableFooter } from './Components/ClickableFooter.jsx';
import ExpansionTable from './Components/ExpansionTable.jsx';

// const pjson = require('../../package.json');

const darkTheme = createTheme({
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

const lightTheme = createTheme({
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

const _winstonLogger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({
             format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.label({ label: 'oi4-local-ui' }),
    ),
    transports: [
        new winston.transports.Console({})
    ]
});

class OI4Base extends React.Component {
    constructor(props) {
        super(props);
        this.platform = 'fetch';
        // this.address = window.location.hostname;
        // The following lines will give access to the external Endpoint for the REST API defined by the Environment variables.
        // This way, the registry backend is fully decoupled from the front-end
        /* eslint-disable */
        if (typeof serviceEndpoint === 'object' && serviceEndpoint !== null) {
            if (serviceEndpoint.address !== null && serviceEndpoint.address.length > 0) {
                this.address = serviceEndpoint.address
            } else {
                this.address = window.location.hostname
            }
            this.port = serviceEndpoint.port || 5799;
            this.platform = serviceEndpoint.platform;
        }
        _winstonLogger.info(`Window.location.hostname: ${this.address}`);
        _winstonLogger.info(`Window.location.port: ${this.port}`);

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
                showRegistry: true,
                developmentMode: false,
            },
            theme: lightTheme,
            darkActivated: false,
            smallLogo: oi4SmallLogoLight,
            bigLogo: oi4BigLogoLight,
            globalEventTrail: [],
            updatingConformity: false,
            filterWord: '',
            brokerState: false,
            backendState: false,
            brokerStateRaw: 'empty',
        };

        this.license = '';
        this.version = '';

        this.controller = new AbortController();
        this.signal = this.controller.signal;
        this.activeIntervals = [];

        // Update apps and devices right away
        setTimeout(() => {
            this.updateApplications();
        }, 500);
        setTimeout(() => {
            this.updateDevices();
        }, 800);
        setTimeout(async () => {
            await this.getBackendConfig();
        }, 300);
        setTimeout(() => {
            this.updateBrokerState();
        }, 500);

        /**
         * Setup cyclic intervals for refreshing the data managed by the registry backend.
         * The resources kept by the registry of all applications are updated individually.
         */
        this.activeIntervals.push(setInterval(() => {
            this.updateHealth();
        }, 7000)); // UpdateHealth gets the health of the registry
        this.activeIntervals.push(setInterval(() => {
            this.updateApplications();
        }, 4000));
        this.activeIntervals.push(setInterval(() => {
            this.updateDevices();
        }, 4000));
        this.activeIntervals.push(setInterval(() => {
            this.updateGlobalEventTrail();
        }, 10000));
        this.activeIntervals.push(setInterval(() => {
            this.updateBrokerState();
        }, 5000));
        this.activeIntervals.push(setInterval(async () => {
            await this.getBackendConfig();
        }, 10000));

        setTimeout(() => {
            this.updateOi4Id();
        }, 300); // This will retrieve the oi4Id of the registry itself.
        setTimeout(() => { // Retrieve license and version from backend
            this.fetch.get('/packageVersion')
                .then(data => {
                    _winstonLogger.info(data);
                    this.version = data;
                })
                .catch(err => {
                    _winstonLogger.info(err);
                    reject(err);
                    reject(err);
                });

            this.fetch.get('/packageLicense')
                .then(data => {
                    _winstonLogger.info(data);
                    this.license = data;
                })
                .catch(err => {
                    _winstonLogger.info(err);
                    reject(err);
                    reject(err);
                });
        }, 500);
        setTimeout(() => {
                if (this.platform === 'cockpit') return;
                this.toggleTheme();
            },
            100);
    }

    componentDidMount() {
        document.body.style.fontSize = '14px';
    }

    componentWillUnmount() {
        this.activeIntervals.forEach(element => clearInterval(element));
    }

    handleFilterChange(ev) {
        this.setState({ filterWord: ev.target.value });
    }

    getBrokerState() {
        if (!this.state.backendState) {
            return {
                text: "---",
                namur: namur_off_spec_3
            };
        } else if (this.state.brokerState) {
            return {
                text: "Connected",
                namur: namur_normal_0
            };
        } else {
            return {
                text: "Disconnected",
                namur: namur_failure_1
            };
        }
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
        const brokerState = this.getBrokerState();
        return (
            <React.Fragment>
                <MuiThemeProvider theme={ this.state.theme }>
                    <CssBaseline />
                    <div className={classes.root}>
                        <AppBar position='static' color='inherit'>
                            <Toolbar>
                                {/* eslint-disable-next-line react/jsx-first-prop-new-line */}
                                <img src={this.state.bigLogo} alt="OI4Logo" style={{ marginRight: '10px', maxWidth: '180px', height: 'auto' }} />
                                <Typography variant='h6' style={{ flexGrow: 1 }}>OEC Registry</Typography>
                                <div style={{ marginRight: '5px' }}>
                                    <Typography variant='h6'>Message Bus:</Typography>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        {/* eslint-disable-next-line react/jsx-first-prop-new-line */}
                                        <Typography variant='h6' display='inline' style={{ marginRight: '10px' }}>{brokerState.text}</Typography>
                                        <img src={brokerState.namur} alt="Namur" height='25px' width='25px' />
                                    </div>
                                </div>
                                <Checkbox
                                    icon={<BrightnessHigh />}
                                    checkedIcon={<Brightness3 />}
                                    checked={this.state.darkActivated}
                                    style={{ marginLeft: '15px' }}
                                    onChange={() => {
                                        this.toggleTheme();
                                    }}
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
                            <Accordion>
                                <AccordionSummary expandIcon={<ExpandMore />}>
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
                                </AccordionSummary>
                                <AccordionDetails className={classes.paper}>
                                    {this.displayGlobalEvents(this.state.globalEventTrail)}
                                </AccordionDetails>
                            </Accordion>

                        </div>
                        {/* Padding for dialog */}
                        <div style={{ flexGrow: 1 }} />
                        <ClickableFooter
                            updateFrontendConfig={this.updateFrontendConfig.bind(this)}
                            config={this.state.config}
                            backendConfig={this.state.backendConfig}
                            fetch={this.fetch}
                            license={this.license}
                            version={this.version}
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
                _winstonLogger.info('Object does have property, but its not the correct type');
                return false;
            }
        } else {
            _winstonLogger.info('Object does not have this property');
            return false;
        }
    }

    /**
     * Toggles the theme between light and dark and switches the logos accordingly
     * @memberof OI4Base
     */
    toggleTheme() {
        if (this.state.darkActivated) {
            this.setState({
                darkActivated: false,
                theme: lightTheme,
                smallLogo: oi4SmallLogoLight,
                bigLogo: oi4BigLogoLight
            });
        } else {
            this.setState({
                darkActivated: true,
                theme: darkTheme,
                smallLogo: oi4SmallLogoDark,
                bigLogo: oi4BigLogoDark
            });
        }
    }

    /**
     * Displays the Events / Events coming from either global or local data sources
     * @param {array} eventArray - an array of the last few events
     */
    displayGlobalEvents(eventArray) {
        const newArray = [];
        eventArray.forEach(items => {
            newArray.push({
                level: items.level,
                number: items.number,
                description: items.description,
                category: items.category,
                details: JSON.stringify(items.details),
            });
        });
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
                            { title: "Level", field: "level", width: '8%', cellStyle: { wordBreak: 'break-all' } },
                            { title: "Number", field: "number", width: '8%', cellStyle: { wordBreak: 'break-all' } },
                            { title: "Category", field: "category", width: '13%', cellStyle: { wordBreak: 'break-all' } },
                            {
                                title: "Description",
                                field: "description",
                                width: '0px',
                                cellStyle: { wordBreak: 'break-all' }
                            },
                            { title: 'Details', field: 'details', cellStyle: { wordBreak: 'break-all' } }
                        ]}
                        style={{ minWidth: '100%' }}
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
                  onClose={() => {
                      this.setState({ copySnackOpen: false });
                  }}
                  autoHideDuration={4000}
                  message='Saved Global Events to clipboard'
                  action={
                      <>
                          {/* eslint-disable-next-line react/jsx-first-prop-new-line */}
                          <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
                              <Close fontSize='small' />
                          </IconButton>
                      </>
                  }
              />
            </span>}
                    />);
            } else {
                return <h3>No items in event list...</h3>;
            }
        }
    }

    // UPDATE-FUNCTIONS OF ASSETS AND RESOURCES //

    updateBrokerState() {
        this.fetch.get('/brokerState')
            .then(data => {
                const newValue = (data === 'true');
                this.setState({ brokerState: newValue });
                this.setState({ backendState: true });
                this.setState({ brokerStateRaw: data });
            })
            .catch(err => {
                this.setState({ backendState: false });
                _winstonLogger.info(err);
                reject(err);
            });
    }

    /**
     * Updates the conformity of the specified asset via the Registry API
     * @param {string} fullTopic - The full topic pointing to the asset
     * @param {string} oi4Id - The oi4Id of the asset
     * @memberof OI4Base
     */
    updateConformity(fullTopic, oi4Id) {
        this.setState({ updatingConformity: true });
        _winstonLogger.info(`Updating Conformity for ${fullTopic} with oi4Id: ${oi4Id}`);
        if (this.state.backendConfig.developmentMode === true) { // If we're in development mode, we retrieve *all* conformity values
            this.fetch.get(`/fullConformity/${encodeURIComponent(fullTopic)}/${encodeURIComponent(oi4Id)}`)
                .then(data => {
                    this.setState({ updatingConformity: false });
                    const jsonData = JSON.parse(data);
                    const confLookup = JSON.parse(JSON.stringify(this.state.conformityLookup));
                    delete confLookup[oi4Id];
                    confLookup[oi4Id] = jsonData;
                    this.setState({ conformityLookup: confLookup, updatingConformity: false });
                })
                .catch(err => {
                    _winstonLogger.info(err);
                    reject(err);
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
                })
                .catch(err => {
                    _winstonLogger.info(err);
                    reject(err);
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
                Object.keys(jsonData).forEach(oi4Id => {
                    // Update auditTrail
                    const eventList = [];
                    const globalEvents = this.state.globalEventTrail.slice(0).reverse();
                    // since this.state.globalEventTrail is only an array-like object, we need to iterate over its items by calling forEach indirectly using call
                    Array.prototype.forEach.call(globalEvents, audits => {
                        if (audits.origin === oi4Id) {
                            eventList.push(audits);
                        }
                    });
                    jsonData[oi4Id].eventList = eventList.reverse();

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
                });
                if (wasUpdated) {
                    this.setState({ listOfDevices: listOfDevices }); // FIXME: Potentially dangerous
                }
                this.setState({ deviceLookup: jsonData, conformityLookup: confLookupLoc });
            })
            .catch(err => {
                _winstonLogger.info(err);
                reject(err);
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
                Object.keys(jsonData).forEach(oi4Id => {
                    // Update auditTrail
                    const eventList = [];
                    const globalEvents = this.state.globalEventTrail.slice(0).reverse();
                    // since this.state.globalEventTrail is only an array-like object, we need to iterate over its items by calling forEach indirectly using call
                    Array.prototype.forEach.call(globalEvents, audits => {
                        if (audits.origin === oi4Id) {
                            eventList.push(audits);
                        }
                    });
                    jsonData[oi4Id].eventList = eventList.reverse();
                    if (oi4Id in confLookupLoc) {
                        delete confLookupLoc[oi4Id];
                    }
                    confLookupLoc[oi4Id] = jsonData[oi4Id].conformityObject;
                });
                this.setState({
                    applicationLookup: jsonData,
                    listOfApps: Object.keys(jsonData),
                    conformityLookup: confLookupLoc
                });
            })
            .catch(err => {
                _winstonLogger.info(err);
                reject(err);
            });
    }

    /**
     * Fetches the specified resource for all applications/devices we know
     * @param {string} resource - the requested resource
     */
    updateRegistryResource(resource) {
        Object.keys(this.state.applicationLookup).forEach(oi4Id => {
            // Check, if we can even get the resource (through conformity lookup)
            if (typeof this.state.conformityLookup[oi4Id] === 'object' && this.state.conformityLookup[oi4Id] !== null) {
                if (resource === 'lastMessage') {
                    this.fetch.get(`/registry/${resource}/${encodeURIComponent(oi4Id)}`)
                        .then(data => {
                            const resourceObject = JSON.parse(data);
                            // TODO: Remove everything except setState and update function!
                            const applicationLookupLoc = JSON.parse(JSON.stringify(this.state.applicationLookup));
                            if (!(_.isEqual(applicationLookupLoc[oi4Id][resource], resourceObject))) {
                                if (typeof resourceObject === 'object' && resourceObject !== null) {
                                    if ('err' in resourceObject) {
                                        _winstonLogger.info(`Received Error in updateRegistryResource (${resource})`);
                                        _winstonLogger.info(resourceObject);
                                    }
                                } else {
                                    applicationLookupLoc[oi4Id][resource] = resourceObject;
                                }
                            }
                            this.setState({ applicationLookup: applicationLookupLoc });
                        })
                        .catch(err => {
                            // _winstonLogger.info(`Error ${err} with Resource ${resource}`);
                            reject(err);
                        });
                } else { // If we don't have it in our lookup, we can return!
                    if (typeof this.state.conformityLookup[oi4Id].resource[resource] !== 'undefined') {
                        // _winstonLogger.info(`The resource ${resource} could not be requested yet, because we are waiting for conformity`);
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
                            _winstonLogger.info(`Error ${err} with Resource ${resource}`);
                            reject(err);
                        });
                }
            }
        });
    }

    // DELETION //
    /**
     * Clear an Asset of the Registry backend by calling the corresponding API
     * @param {string} oi4Id - The oi4Id of the Asset that is to be deleted
     * @memberof OI4Base
     */
    clearAssetById(oi4Id) {
        _winstonLogger.info('Clear Asset by Id clicked');
        this.fetch.delete(`/registry/assets/${encodeURIComponent(oi4Id)}`)
            .then(data => {
                _winstonLogger.info(data);
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
            })
            .catch(err => {
                _winstonLogger.info(err);
                reject(err);
            });
    }

    /**
     * Fetch the oi4Id of the Registry itself
     * @memberof OI4Base
     */
    updateOi4Id() {
        this.fetch.get('')
            .then(data => {
                _winstonLogger.info(data);
                this.setState({ oi4Id: JSON.parse(data) });
            })
            .catch(err => {
                _winstonLogger.info(err);
                reject(err);
                reject(err);
            });
    }

    // CALLBACKS FOR CLICKABLE FOOTER //

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

    async retrieveBackendConfig() {
        try {
            const data = await this.fetch.get(`/registry/config`);
            const regConfData = JSON.parse(data); // Format from backend!
            return regConfData;
        } catch (err) {
            _winstonLogger.info(err);
            throw err;
        }
    }

    /**
     * Updates the local copy of the backendConfig by getting it from the corresponding API
     * @memberof OI4Base
     */
    async getBackendConfig() {
        const regConfData = await this.retrieveBackendConfig();
        const backendConfig = {
            showRegistry: regConfData.registry.showRegistry.value === 'true',
            developmentMode: regConfData.registry.developmentMode.value === 'true',
        };
        this.setState({ backendConfig: backendConfig });
    }

    /**
     * Fetch the most recent event trail from the Registry
     * @memberof OI4Base
     */
    updateGlobalEventTrail() {
        this.fetch.get(`/registry/event/${this.state.config.auditTrailLength}`)
            .then(data => {
                this.setState({ globalEventTrail: JSON.parse(data) });
            })
            .catch(err => {
                _winstonLogger.info(err);
                reject(err);
            });
    }
}

OI4Base.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles, { withTheme: true })(OI4Base);
