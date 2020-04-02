import React, { Fragment } from 'react';

import PropTypes from 'prop-types';

import {
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  Divider,
  Link,
  Grid,
  Tabs,
  Tab,
  Box,
  Checkbox,
  TextField,
  Button,
  Select,
  MenuItem,
  InputAdornment,
} from '@material-ui/core';

import { DeleteForever, GetApp, Publish } from '@material-ui/icons';

function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <Typography
      component='div'
      role='tabpanel'
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && <Box p={3}>{children}</Box>}
    </Typography>
  );
}

TabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.any.isRequired,
  value: PropTypes.any.isRequired,
};

export class ClickableFooter extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      dialogOpen: false,
      selectedTab: 0,
    };
  }

  render() {
    return (<Fragment>
      <Dialog
        open={this.state.dialogOpen}
        onClose={() => this.setState({ dialogOpen: false })}
        maxwidth='lg'
      >
        <DialogTitle><img src={this.props.bigLogo} alt="OI4Logo2" style={{ textAlign: 'center', maxWidth: '550px', height: 'auto' }} /></DialogTitle>
        <DialogContent>
          <Divider variant='middle' />
          <Tabs value={this.state.selectedTab} onChange={this.handleChange} centered>
            <Tab label="Information" />
            <Tab label="Expert Configuration" />
          </Tabs>
          <TabPanel value={this.state.selectedTab} index={0}>
            <Typography variant='h5' style={{ textAlign: 'center' }}>Registry Information</Typography>
            <DialogContent style={{ paddingLeft: '13px', paddingRight: '13px' }}>
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
              </p>
              <ul>
                <li>Fully passed all tests for GET/PUB methods and related payload formats: <span role='img' aria-label='ok'>✅</span></li>
                <li>Partially passed because GET/PUB methods were answered, but related payload was not correct: <span role='img' aria-label='warn'>⚠️</span></li>
                <li>Failed because mandatory GET methods are not answered: <span role='img' aria-label='nok'>❌</span></li>
                <li>Not yet tested (neither successful nor fail): <span role='img' aria-label='default'>❔</span></li>
              </ul>
              <p>
                The conformity icon in the header bar is an indication of overall conformity.
              </p>
              <p>
                The refresh button will initiate a new conformity check.
              </p>
            </DialogContent>
          </TabPanel>
          <TabPanel value={this.state.selectedTab} index={1}>
            <DialogContent style={{ paddingLeft: '13px', paddingRight: '13px' }}>
              <p>In this section, expert configurations can be set by the maintainer.</p>

              <p>The expert mode will allow the following options:</p>

              <ul>
                <li>Load and store the config to and from a JSON</li>
                <li>Maintainer Actions
                  <ul>
                    <li>Delete a single asset (accessible in the Asset table)</li>
                    <li>Delete all assets. Warning: This will clear the database of the registry.</li>
                    <li>Delete all logfiles. If logging to a file is enable, this will delete all files on the disk.</li>
                  </ul>
                </li>
                <li>Frontend Configuration
                  <ul>
                    <li>Edit the count of shown Audit elements in the global and local event trail.</li>
                  </ul>
                </li>
                <li>Backend Configuration
                  <ul>
                    <li>Enable showing the Registry in the application table</li>
                    <li>Edit the audit level the Registry will listen to. This will affect what events will be shown in the event table.</li>
                    <li>Enable logging to file. This can either enable the file-logger or enable it.</li>
                    <li>Edit the logfile size. The logfile size (if logging is enabled) can be adjusted from 500kB to 10MB.</li>
                  </ul>
                </li>
              </ul>

              <div style={{ marginTop: '1em', marginBottom: '1em' }}>Enable / Disable the expert mode:
                <Checkbox
                  checked={this.props.backendConfig.developmentMode || false} // Default value needed to stay in controlled mode
                  onChange={this.props.handleExpertChange} // lifting state up
                  value='primary'
                />
              </div>

              {/* ENTRYPOINT OF DEVELOPMENT MODE */}
              {this.props.backendConfig.developmentMode ? <>

                <div style={{ marginTop: '1em', marginBottom: '1em' }}>
                  <Button endIcon={<GetApp />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={() => { this.props.saveToFile() }}>
                  Save config
                    </Button>
                  <input
                    accept=".json"
                    id="contained-button-file"
                    type="file"
                    onChange={(e) => { this.props.handleLoadFromFile(e) }}
                    style={{ display: 'none' }}
                  />
                  <label htmlFor='contained-button-file'>
                    <Button
                    endIcon={<Publish />}
                    color='secondary'
                    size='small'
                    style={{ marginLeft: '10px' }}
                    variant="contained"
                    component='span'
                    >
                      Load config
                    </Button>
                  </label>
                </div>

                <span style={{ fontSize: '18px' }}>Maintainer Actions</span>
                <Divider />
                <div style={{ marginTop: '1em', marginBottom: '1em' }}>
                  <Button endIcon={<DeleteForever />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={() => { this.props.clearAllAssets() }}>
                  Delete all Assets <span role='img' aria-label='warn'>⚠️</span>
                    </Button></div>
                <div style={{ marginTop: '1em', marginBottom: '1em' }}>
                  <Button endIcon={<DeleteForever />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={() => { this.props.clearAllLogs() }}>
                  Delete all Logfiles <span role='img' aria-label='warn'>⚠️</span>
                    </Button></div>

                <span style={{ fontSize: '18px' }}>Frontend Configuration
                  <Button endIcon={<GetApp />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={this.props.handleGetConfig}>
                    Get
                    </Button>
                  <Button endIcon={<Publish />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={this.props.handleSetConfig}>
                    Set
                    </Button>
                </span>
                <Divider />
                <div style={{ marginTop: '1em', marginBottom: '1em' }}>Count of shown Audit Elements:
                  <Select
                    value={this.props.config.globalEventListLength || ''}
                    onChange={this.props.handleGlobalTrailLength}
                    style={{ marginLeft: '10px', marginRight: '10px' }}
                  >
                    <MenuItem value={25}>25</MenuItem>
                    <MenuItem value={50}>50</MenuItem>
                    <MenuItem value={100}>100</MenuItem>
                    <MenuItem value={200}>200</MenuItem>
                    <MenuItem value={400}>400</MenuItem>
                  </Select>
                </div>

                <span style={{ fontSize: '18px' }}>Backend Configuration
                  <Button endIcon={<GetApp />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={this.props.handleGetConfig}>
                    Get
                    </Button>
                  <Button endIcon={<Publish />} color='secondary' size='small' style={{ marginLeft: '10px' }} variant="contained" onClick={this.props.handleSetConfig}>
                    Set
                    </Button>
                </span>
                <Divider />
                <div style={{ marginTop: '1em', marginBottom: '1em' }}>Show / Add Registry to Database:
                  <Checkbox
                    checked={this.props.backendConfig.showRegistry || false} // Default value needed to stay in controlled mode
                    onChange={this.props.handleShowRegistryChange} // lifting state up
                    value='primary'
                  />
                </div>

                <div style={{ marginTop: '1em', marginBottom: '1em' }}>Set Audit Level:
                  <Select
                    value={this.props.backendConfig.auditLevel || ''}
                    onChange={this.props.handleAuditLevelChange}
                    color='primary'
                    style={{ marginLeft: '10px' }}
                  >
                    <MenuItem value='trace'>Trace</MenuItem>
                    <MenuItem value='debug'>Debug</MenuItem>
                    <MenuItem value='info'>Info</MenuItem>
                    <MenuItem value='warn'>Warn</MenuItem>
                    <MenuItem value='error'>Error</MenuItem>
                    <MenuItem value='fatal'>Fatal</MenuItem>
                  </Select>
                </div>

                <div style={{ marginTop: '1em', marginBottom: '1em' }}>Enable Logging to file:
                  <Select
                    value={this.props.backendConfig.logToFile || 'disabled'}
                    onChange={this.props.handleLogToFileChange}
                    color='primary'
                    style={{ marginLeft: '10px' }}
                  >
                    <MenuItem value='enabled'>Log to local file</MenuItem>
                    <MenuItem value='disabled'>Disable storage</MenuItem>
                    <MenuItem value='endpoint'>Custom Endpoint</MenuItem>
                  </Select>
                </div>

                <div style={{ marginTop: '1em', marginBottom: '1em' }}>Logfile Size:
                  <TextField
                    error={this.props.backendConfig.logFileSize <= 10 || this.props.backendConfig.logFileSize >= 10000}
                    id="outlined-number"
                    type="number"
                    min='20'
                    value={this.props.backendConfig.logFileSize || ''}
                    onChange={this.props.handleGlobalTrailSize}
                    helperText={this.props.backendConfig.logFileSize <= 10 || this.props.backendConfig.logFileSize >= 10000 ? 'Value out of bounds!' : ''}
                    InputProps={{
                      inputProps: {
                        min: '500',
                        max: '10000',
                        step: '250',
                      },
                      endAdornment: (
                        <InputAdornment position="end">kB</InputAdornment>
                      ),
                    }}
                    layout='dense'
                    size='small'
                    style={{ marginLeft: '10px', marginRight: '10px', width: '30%' }}
                  />
                </div>
                <span style={{ fontSize: '18px' }}>Developer Options
                </span>
                <Divider />
                <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleUpdateTrail}>
                  Force Update Global Trail
                    </Button>
              </> : null}
            </DialogContent>
          </TabPanel>
          <Divider variant='middle' />
          <Typography style={{ textAlign: 'center' }} variant='body2'>Copyright (C): 2019 Hilscher Gesellschaft für Systemautomation mbH</Typography>
        </DialogContent>
      </Dialog>
      <Grid container justify='center' style={{ paddingBottom: '10px' }}>
        <Typography>License: {this.props.license} | Version: {this.props.version} |
          <Link
            color='inherit'
            onClick={(e) => {
              e.preventDefault();
              this.setState({ dialogOpen: true });
            }}
            style={{ marginLeft: '4px' }}
          >
            Click for more Information
            </Link>
        </Typography>
      </Grid>
    </Fragment>
    );
  }

  handleChange = (event, newValue) => {
    this.setState({ selectedTab: newValue });
  };
}
