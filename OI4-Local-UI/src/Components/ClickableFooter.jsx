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
  Button
} from '@material-ui/core';

import { DeleteForever, GetApp } from '@material-ui/icons';

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
          <Tabs value={this.state.selectedTab} onChange={this.handleChange} aria-label="simple tabs example">
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
                  checked={this.props.config.developmentMode || false} // Default value needed to stay in controlled mode
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
              {this.props.config.developmentMode ? <>Dump config data to file: <IconButton size='small' color='default' onClick={() => { this.props.saveToFile() }}>
                <GetApp />
              </IconButton></> : null}
              {this.props.config.developmentMode ? <>Delete all Assets(!): <IconButton size='small' color='default' onClick={() => { this.props.clearAllAssets() }}>
                <DeleteForever />
              </IconButton></> : null}
              {/* <div>Local (Frontend)</div>
              <div>
                <TextField
                  id="outlined-number"
                  label="Asset"
                  type="number"
                  value={this.props.config.assetEventListLength}
                  onChange={this.props.handleLocalTrailLength}
                  InputLabelProps={{
                    shrink: true,
                  }}
                  size='small'
                  style={{ margin: '10px' }}
                />
                <TextField
                  id="outlined-number"
                  label="Global"
                  type="number"
                  value={this.props.config.globalEventListLength}
                  onChange={this.props.handleGlobalTrailLength}
                  InputLabelProps={{
                    shrink: true,
                  }}
                  size='small'
                  style={{ margin: '10px' }}
                />
              </div> */}
              <div>
                {this.props.config.developmentMode ? <>
                  <div>
                    Registry (Backend)
              </div>
                  <TextField
                    id="outlined-number"
                    label="Asset"
                    type="number"
                    value={this.props.config.assetEventListLength}
                    onChange={this.props.handleLocalTrailLength}
                    InputLabelProps={{
                      shrink: true,
                    }}
                    size='small'
                    style={{ margin: '10px' }}
                  />
                  <TextField
                    id="outlined-number"
                    label="Global"
                    type="number"
                    value={this.props.config.globalEventListLength}
                    onChange={this.props.handleGlobalTrailLength}
                    InputLabelProps={{
                      shrink: true,
                    }}
                    size='small'
                    style={{ margin: '10px' }}
                  />
                  <div>
                    <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleGetTrailLength}>
                      Get
                    </Button>
                    <Button variant="contained" style={{ margin: '10px' }} onClick={this.props.handleSetTrailLength}>
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
