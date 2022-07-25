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
  // InputAdornment,
} from '@material-ui/core';

import namur_normal_0 from '../Images/namur_normal_0.png';
import namur_failure_1 from '../Images/namur_failure_1.png';
import namur_off_spec_3 from '../Images/namur_off_spec_3.png';

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

  /**
   * Main render method of the ClickableFooter
   * @memberof OI4Base
   */
  render() {
    const url = `https://${this.props.fetch.address}:${this.props.fetch.port}`;
    // const url = 'https://' + this.props.fetch.address + ':' + this.props.fetch.port;
    return (<Fragment>
          <Dialog
              open={this.state.dialogOpen}
              onClose={() => this.setState({ dialogOpen: false })}
              maxWidth='md'
          >
            <DialogTitle style={{ textAlign: 'center' }}><img src={this.props.bigLogo} alt="OI4Logo2" style={{ maxWidth: '400px', height: 'auto' }} /></DialogTitle>
            <DialogContent>
              <Divider variant='middle' />
              <Tabs value={this.state.selectedTab} onChange={this.handleChange} centered>
                <Tab label="Information" />
              </Tabs>
              <TabPanel value={this.state.selectedTab} index={0}>
                <Typography variant='h5' style={{ textAlign: 'center' }}>OEC Registry Information</Typography>
                <DialogContent style={{ paddingLeft: '10px', paddingRight: '10px' }}>
                  <p>
                    Be aware to start the Open Industry 4.0 Alliance's OEC Registry as the very first application in the runtime.
                    Otherwise, you might miss information from other applications and devices.
                  </p>
                  <p>
                    The OEC Registry will list all applications and devices, which are communicating in a conform way to Open Industry 4.0 Alliance.
                    It also displays the event trail of all Open Industry 4.0 Alliance events on the message bus.
                  </p>
                  <p>
                    Every recognized asset gets tested for a basic set of compatibility to Open Industry 4.0 Alliance specification. The result will be displayed as one of:
                  </p>
                  <ul>
                    {/* <li>Fully passed all tests for GET/PUB methods and related payload formats: <span role='img' aria-label='ok'>✅</span></li>
                <li>Partially passed because GET/PUB methods were answered, but related payload was not correct: <span role='img' aria-label='warn'>⚠️</span></li>
                <li>Failed because mandatory GET methods are not answered: <span role='img' aria-label='nok'>❌</span></li> */}
                    <li>Fully passed all tests for GET/PUB methods and related payload formats: <img style={{ verticalAlign: 'middle' }} src={namur_normal_0} alt="Namur" height='20px' width='20px' /></li>
                    <li>Partially passed because GET/PUB methods were answered, but related payload was not correct: <img style={{ verticalAlign: 'middle' }} src={namur_off_spec_3} alt="Namur" height='20px' width='20px' /></li>
                    <li>Failed because mandatory GET methods are not answered: <img style={{ verticalAlign: 'middle' }} src={namur_failure_1} alt="Namur" height='20px' width='20px' /></li>
                    <li>Not yet tested (neither successful nor fail): <span style={{ verticalAlign: 'middle' }} role='img' aria-label='default'>❔</span></li>
                  </ul>
                  <p>
                    The conformity icon in the header bar is an indication of overall conformity.
                  </p>
                  <p>
                    The refresh button will initiate a new conformity check.
                  </p>
                  <p>
                    OI4 Registry web service location: <a href={url}>{url}</a>
                  </p>
                </DialogContent>
              </TabPanel>
              <Divider variant='middle' style={{ marginBottom: '1em' }} />
              <Typography style={{ textAlign: 'center', marginBottom: '1em' }} variant='body2'>Copyright (C): 2022 Open Industry 4.0 Alliance - Community</Typography>
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
