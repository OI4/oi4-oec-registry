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
  IconButton,
  TextField,
  Button,
  Select,
  MenuItem,
  Slider
} from '@material-ui/core';

import { DeleteForever, GetApp, /* Publish */ } from '@material-ui/icons';

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
              <p>First, enable the expert checkbox to the right:
                <Checkbox
                  checked={this.props.backendConfig.developmentMode || false} // Default value needed to stay in controlled mode
                  onChange={this.props.handleExpertChange} // lifting state up
                  value='primary'
                />
              </p>
              <p>The expert mode will allow the following options:</p>
              <ul>
                <li>Delete single assets by clicking on the trash icon next to the asset</li>
                <li>Delete all assets from the registry as a cleanup measure (Warning!)</li>
                <li>Adjust the buffer length of the global event trail server-sided (without expert mode, this setting only works client-side) - TODO</li>
                <li>Set a server-sided filter for assets - TODO</li>
              </ul>
              <div style={{ margin: '10px' }}>
                {this.props.backendConfig.developmentMode ? <>Dump config data to file: <IconButton size='small' color='default' onClick={() => { this.props.saveToFile() }}>
                  <GetApp />
                </IconButton></> : null}
              </div>
              <div style={{ margin: '10px' }}>
                {this.props.backendConfig.developmentMode ? <>Load config from file:
                  <input
                    accept=".json"
                    id="contained-button-file"
                    type="file"
                    onChange={(e) => { this.props.handleLoadFromFile(e) }}
                  />
                  {/*
                  <label htmlFor="contained-button-file">
                    <IconButton size='small' color='default'>
                      <Publish />
                    </IconButton>
                  </label>
                */}</> : null}
              </div>
              <div style={{ margin: '10px' }}>
                {this.props.backendConfig.developmentMode ? <>Delete all Assets(!): <IconButton size='small' color='default' onClick={() => { this.props.clearAllAssets() }}>
                  <DeleteForever />
                </IconButton></> : null}
              </div>
              <div style={{ margin: '10px' }}>
                {this.props.backendConfig.developmentMode ? <>Delete all Logs(!): <IconButton size='small' color='default' onClick={() => { this.props.clearAllLogs() }}>
                  <DeleteForever />
                </IconButton></> : null}
              </div>
              <div>
                {this.props.backendConfig.developmentMode ? <>
                  <p style={{ fontSize: '24px' }}>
                    Registry (Backend) - Configuration:
                  </p>
                  <p>Show / Add Registry to Database:
                  <Checkbox
                        checked={this.props.backendConfig.showRegistry || false} // Default value needed to stay in controlled mode
                        onChange={this.props.handleShowRegistryChange} // lifting state up
                        value='primary'
                  />
                  </p>
                  <TextField
                    id="outlined-number"
                    label="Global Log Elements"
                    type="number"
                    value={this.props.config.globalEventListLength || ''}
                    onChange={this.props.handleGlobalTrailLength}
                    InputLabelProps={{
                      shrink: true,
                    }}
                    size='small'
                    style={{ margin: '10px' }}
                  />
                  <div style={{ margin: '10px' }}>
                    <>Set Audit Level:</>
                    <Select
                      value={this.props.backendConfig.auditLevel || ''}
                      onChange={this.props.handleAuditLevelChange}
                    >
                      <MenuItem value='trace'>Trace</MenuItem>
                      <MenuItem value='debug'>Debug</MenuItem>
                      <MenuItem value='info'>Info</MenuItem>
                      <MenuItem value='warn'>Warn</MenuItem>
                      <MenuItem value='error'>Error</MenuItem>
                      <MenuItem value='fatal'>Fatal</MenuItem>
                    </Select>
                  </div>
                  <p>Enable Logging to file:
                  <Checkbox
                      checked={this.props.backendConfig.logToFile || false} // Default value needed to stay in controlled mode
                      onChange={this.props.handleLogToFileChange} // lifting state up
                      value='primary'
                  />
                  </p>
                  <p>File Log Size</p>
                  <Slider
                    color='secondary'
                    defaultValue={200000}
                    step={50000}
                    onChange={this.props.handleGlobalTrailSize}
                    value={this.props.backendConfig.logFileSize}
                    valueLabelDisplay='auto'
                    min={40000}
                    valueLabelFormat={function (value) { return `${value / 1000}K` }}
                    max={1000000}
                  />
                  <div>
                    <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleGetConfig}>
                      Get
                    </Button>
                    <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleSetConfig}>
                      Set
                    </Button>
                    <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleUpdateTrail}>
                      Force Update Global Trail
                    </Button>
                  </div>
                </> : null}
              </div>
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
