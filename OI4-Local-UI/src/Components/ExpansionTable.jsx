import React from 'react';

import { withStyles } from '@material-ui/core/styles';

import namur0 from '../Images/namur_0.png';
import namur1 from '../Images/namur_1.png';
import namur2 from '../Images/namur_2.png';
import namur3 from '../Images/namur_3.png';
import namur4 from '../Images/namur_4.png';

// import MaterialTable from 'material-table';

import PropTypes from 'prop-types';

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
  Collapse,
  IconButton,
} from '@material-ui/core';

import {
  ExpandMore,
  ExpandLess,
} from '@material-ui/icons';

import ExpansionTableDetail from './ExpansionTableDetail';

const styles = theme => ({
  table: {
  },
  tableInside: {
    padding: theme.spacing(2),
    fontWeight: 100,
    minHeight: '100vh',
    fontSize: 'calc(5px + 1vmin)',
  },
  tableWrap: {
    overflow: 'auto'
  },
});

class ExpansionTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      expandedLookup: {},
      namurLookup: {
        NORMAL_0: namur0,
        FAILURE_1: namur1,
        CHECK_FUNCTION_2: namur2,
        OFF_SPEC_3: namur3,
        MAINTENANCE_REQUIRED_4: namur4,
      },
      tableName: `${this.props.lookupType.substring(0, 1).toUpperCase()}${this.props.lookupType.substring(1)} Table`, // First character to UpperCase, concatenate the rest
      validityLookup: {
        0: '❔',
        1: '✅',
        2: '⚠️',
        3: '❌',
      },
    };
  }

  render() {
    const { classes } = this.props;
    return (
      <>
        {/* <MaterialTable
          title={this.state.tableName}
          columns={[
            { title: 'Manufacturer', field: 'manufacturer' },
            { title: 'Model', field: 'model' },
            { title: 'DeviceClass', field: 'deviceclass' },
            { title: 'SerialNumber', field: 'serialnumber' },
            { title: 'Health', field: 'health' },
            { title: 'Last Message', field: 'lastmessage' },
            { title: 'Conformity', field: 'conformity' },
            { title: 'Expand', field: 'expand' },
          ]}
          data={
            Object.keys(this.props.assetLookup).map((oi4Id) => {
              return {
                oi4Id: oi4Id,
                 manufacturer: this.props.assetLookup[oi4Id].resources.mam.Manufacturer.Text,
                 model: this.props.assetLookup[oi4Id].resources.mam.Model.Text,
                 deviceclass: this.props.assetLookup[oi4Id].resources.mam.DeviceClass,
                 serialnumber: this.props.assetLookup[oi4Id].resources.mam.SerialNumber,
                 health: this.displayNamurHealth(this.getHealth(oi4Id, 'application')),
                 lastmessage: this.props.assetLookup[oi4Id].lastMessage,
                 conformity: <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>,
              };
            })
          }
          detailPanel={rowData => {
            return (
              <div>
                <ExpansionTableDetail
                  asset={this.props.assetLookup[rowData.oi4Id]}
                  conformityLookup={this.props.conformityLookup}
                  oi4Id={rowData.oi4Id}
                  assetLookup={this.props.assetLookup}
                  updateConformity={this.updateConformity.bind(this)}
                  lookupType={this.props.lookupType}
                  fontColor={this.props.fontColor}
                  updatingConformity={this.props.updatingConformity}
                />
                <div>
                  <h3>Last 3 Events:</h3>
                  {this.displayEvents(this.props.assetLookup[rowData.oi4Id].eventList, 'local')}
                </div>
              </div>
            );
          }}
        /> */}
        <ExpansionPanel>
          <ExpansionPanelSummary expandIcon={<ExpandMore />}> {this.state.tableName}: ({Object.keys(this.props.assetLookup).length} entries)</ExpansionPanelSummary>
          <ExpansionPanelDetails className={classes.tableWrap}>
            <Table className={classes.table}>
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
                {Object.keys(this.props.assetLookup).map((oi4Id, idx) => (
                  <React.Fragment key={`AssetTable-${oi4Id}-${idx}`}>
                    <TableRow
                      key={`AssetTable-${oi4Id}-${idx}`}
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
                      <TableCell component="th" scope="row">{this.props.assetLookup[oi4Id].resources.mam.Manufacturer.Text}</TableCell>
                      <TableCell component="th" scope="row">{this.props.assetLookup[oi4Id].resources.mam.Model.Text}</TableCell>
                      <TableCell component="th" scope="row">{this.props.assetLookup[oi4Id].resources.mam.DeviceClass}</TableCell>
                      <TableCell component="th" scope="row">{this.props.assetLookup[oi4Id].resources.mam.SerialNumber}</TableCell>
                      <TableCell align="right">{this.displayNamurHealth(this.getHealth(oi4Id, 'application'))}</TableCell>
                      <TableCell align="right">{this.props.assetLookup[oi4Id].lastMessage}</TableCell>
                      <TableCell align="right">
                        <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size='small' color='default'>
                          {this.displayTableExpansion(oi4Id)}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                    <TableRow key={`AssetTableDetail-${oi4Id}-${idx}`}>
                      <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                        <Collapse
                          className={classes.tableInside}
                          in={this.state.expandedLookup[oi4Id]}
                          timeout='auto'
                          unmountOnExit
                        >
                          <div>
                            <ExpansionTableDetail
                              asset={this.props.assetLookup[oi4Id]}
                              conformityLookup={this.props.conformityLookup}
                              oi4Id={oi4Id}
                              assetLookup={this.props.assetLookup}
                              updateConformity={this.updateConformity.bind(this)}
                              lookupType={this.props.lookupType}
                              fontColor={this.props.fontColor}
                              updatingConformity={this.props.updatingConformity}
                            />
                            <div>
                              <h3>Last 3 Events:</h3>
                              {this.displayEvents(this.props.assetLookup[oi4Id].eventList, 'local')}
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
      </>
    );
  }

  /**
   * Checks if the health property of the payload is available and prints it, if yes.
   *
   * @param {string} oi4Id
   * @param {string} [type='application']
   * @returns The actual health object of the payload, if it finds anything, an error string, if it does not
   * @memberof ExpansionTable
   */
  getHealth(oi4Id, type = 'application') {
    let lookup;
    if (type === 'application') {
      lookup = this.props.assetLookup;
    } else {
      return 'wrong type selected';
    }
    if ('health' in lookup[oi4Id].resources) {
      if ('health' in lookup[oi4Id].resources.health) {
        return lookup[oi4Id].resources.health.health;
      }
    }
    return 'Error - getHealth: health string not found in lookup';
  }

  /**
   * Checks the state of the expansion of the table and returns the corresponding icon
   *
   * @param {string} oi4Id
   * @returns ExpandMore-Icon, if the table is not expanded ; ExpandLess-Icon, if it is expanded
   * @memberof ExpansionTable
   */
  displayTableExpansion(oi4Id) {
    if (!this.state.expandedLookup[oi4Id]) {
      return <ExpandMore />;
    } else {
      return <ExpandLess />;
    }
  }

  /**
   * Displays the validity result of the overall conformity in Emoji-Form
   *
   * @param {string} oi4Id
   * @returns An emoji, if the item is available, 'wait...' string, if it is not
   * @memberof ExpansionTable
   */
  displayConformityHeader(oi4Id) {
    if (this.props.conformityLookup[oi4Id]) {
      return this.state.validityLookup[this.props.conformityLookup[oi4Id].validity];
    } else {
      return 'Wait...';
    }
  }

  /**
   * Displays the received namur health as the corresponding image in the header
   *
   * @param {string} status The healthstatus according to NAMUR spec
   * @param {string} [height='25']
   * @param {string} [width='30']
   * @returns An image of the NAMUR health, if the status is valid. 'Undefined NamurHealth', if it is not
   * @memberof ExpansionTable
   */
  displayNamurHealth(status, height = '25', width = '30') {
    if (!(status in this.state.namurLookup)) {
      return 'Undefined NamurHealth';
    } else {
      return <img src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
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

  /**
   * Callback handler in order to update the conformity of a buttonpress.
   * Calls the parent callback to handle the function.
   *
   * @param {string} fullTopic
   * @param {string} appId
   * @memberof ExpansionTable
   */
  updateConformity(fullTopic, appId) {
    console.log(`Updating Conformity for ${fullTopic} with appId: ${appId} FROM EXPANSTIONTABLE COMPONENT`);
    this.props.updateConformity(fullTopic, appId);
  }
}

ExpansionTable.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(ExpansionTable);
