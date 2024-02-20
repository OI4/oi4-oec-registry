import React from 'react';

import { withStyles } from '@material-ui/core/styles';

import aas_img from '../Images/OI4_AAS_logo.png';
import namur_normal_0 from '../Images/namur_normal_0.png';
import namur_failure_1 from '../Images/namur_failure_1.png';
import namur_check_function_2 from '../Images/namur_check_function_2.png';
import namur_off_spec_3 from '../Images/namur_off_spec_3.png';
import namur_maintenance_required_4 from '../Images/namur_maintenance_required_4.png';

import PropTypes from 'prop-types';

import MaterialTable from 'material-table';

import {
  Typography,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Collapse,
  IconButton,
  TextField,
  InputAdornment,
  Grid,
  Snackbar,
  Tooltip,
} from '@material-ui/core';

import {
  ExpandMore,
  ExpandLess,
  Delete,
  Search,
  FileCopy,
  Close,
} from '@material-ui/icons';

import ExpansionTableDetail from './ExpansionTableDetail.jsx';

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
    overflowX: 'auto',
    overflowY: 'hidden',
    flexDirection: 'column', // AccordionDetail is a flex container!
  },
});

class ExpansionTable extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      expandedLookup: {},
      namurLookup: {
        NORMAL_0: namur_normal_0,
        FAILURE_1: namur_failure_1,
        CHECK_FUNCTION_2: namur_check_function_2,
        OFF_SPEC_3: namur_off_spec_3,
        MAINTENANCE_REQUIRED_4: namur_maintenance_required_4,
      },
      rowOpacity: '1.0',
      tableName: `${this.props.lookupType.substring(0, 1).toUpperCase()}${this.props.lookupType.substring(1)} Table`, // First character to UpperCase, concatenate the rest
      validityLookup: {
        0: '❔',
        1: <img src={namur_normal_0} alt="Namur" height='25px' width='25px' />,
        2: <img src={namur_off_spec_3} alt="Namur" height='25px' width='25px' />,
        3: <img src={namur_failure_1} alt="Namur" height='25px' width='25px' />,
      },
      filterWord: '',
      filterWordEvent: '',
    };
  }

  /**
   * Main render method of the ExpansionTable
   * @memberof OI4Base
   */
  render() {
    const { classes } = this.props;
    return (
        <>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <div>{this.state.tableName}: ({Object.keys(this.props.assetLookup).length} entries)</div>
              <TextField
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
              />
            </AccordionSummary>
            <AccordionDetails className={classes.tableWrap}>
              <Table className={classes.table}>
                <TableHead>
                  <TableRow>
                    <TableCell>Manufacturer</TableCell>
                    <TableCell>Model</TableCell>
                    <TableCell>DeviceClass</TableCell>
                    <TableCell>SerialNumber</TableCell>
                    <TableCell align="right">Health</TableCell>
                    <TableCell align="right">AAS</TableCell>
                    <TableCell align="right">Last Message</TableCell>
                    <TableCell align="right">Conformity</TableCell>
                    <TableCell align="right">Expand</TableCell>
                    {this.props.expertMode ? <TableCell align='right'>Delete</TableCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.keys(this.filterAssets()).map((oi4Id, idx) => (
                      <React.Fragment key={`AssetTable-${oi4Id}-${idx}`}>
                        {/* {console.log((parseFloat(+(this.props.assetLookup[oi4Id].available)) + 0.5).toString())}
                    {console.log(oi4Id)} */}
                        <TableRow
                            key={`AssetTable-${oi4Id}-${idx}`}
                            hoverstyle={{ cursor: "pointer" }}
                            style={{ opacity: (parseFloat(+(this.props.assetLookup[oi4Id].available)) + 0.5).toString() }}
                            // FIXME: A bit hacky: we get a bool from availability. Opacity over 1.0 does not hurt, so we add 0.5 to it. false(0) will result in 0.5
                            // and true(1) will result in 1.5 To parse a bool into a float, we need to make it an integer, this is achieved by + operator
                            // (nodejs type inference) then parse it to float, add it together and convert it to a string
                        >
                          <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'MAM').Manufacturer.Text}</TableCell>
                          <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'MAM').Model.Text}</TableCell>
                          <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'MAM').DeviceClass}</TableCell>
                          <TableCell component="th" scope="row">{this.getResourceObject(oi4Id, 'MAM').SerialNumber}</TableCell>
                          <TableCell align="right">{this.displayNamurHealth(this.getHealth(oi4Id, 'application'))}</TableCell>
                          <TableCell align="right">{this.displayAASIcon(oi4Id)}</TableCell>
                          <TableCell align="right">{this.props.assetLookup[oi4Id].lastMessage}</TableCell>
                          <TableCell align="right">
                            <Typography variant='h6'><span role="img" aria-label="check">{this.displayConformityHeader(oi4Id)}</span></Typography>
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                                size='small'
                                color='default'
                                onClick={() => {
                                  const expandedLookupCopy = JSON.parse(JSON.stringify(this.state.expandedLookup));
                                  if (oi4Id in expandedLookupCopy) {
                                    expandedLookupCopy[oi4Id] = !(expandedLookupCopy[oi4Id]);
                                  } else {
                                    expandedLookupCopy[oi4Id] = true;
                                  }
                                  this.setState({ expandedLookup: expandedLookupCopy });
                                }}
                            >
                              {this.displayTableExpansion(oi4Id)}
                            </IconButton>
                          </TableCell>
                          {this.props.expertMode ? <TableCell align="right">
                            <IconButton
                                size='small'
                                color='default'
                                onClick={(evt) => {
                                  evt.preventDefault();
                                  this.props.clearAsset(oi4Id);
                                }}
                            >
                              <Delete />
                            </IconButton>
                          </TableCell> : null}
                        </TableRow>
                        <TableRow key={`AssetTableDetail-${oi4Id}-${idx}`}>
                          <TableCell colSpan={8}>
                            <Collapse
                                className={classes.tableInside}
                                in={this.state.expandedLookup[oi4Id]}
                                timeout='auto'
                                unmountOnExit
                            >
                              <Grid container>
                                <Grid item xs={12}>
                                  <ExpansionTableDetail
                                      asset={this.props.assetLookup[oi4Id]}
                                      conformityLookup={this.props.conformityLookup}
                                      expertMode={this.props.expertMode}
                                      oi4Id={oi4Id}
                                      assetLookup={this.props.assetLookup}
                                      aasookup={this.props.aasLookup}
                                      updateConformity={this.updateConformity.bind(this)}
                                      getResourceObject={this.getResourceObject.bind(this)}
                                      lookupType={this.props.lookupType}
                                      fontColor={this.props.fontColor}
                                      updatingConformity={this.props.updatingConformity}
                                  />
                                </Grid>
                                {/* <Grid item xs={12}>
                              <h3>{`Last ${this.props.assetLookup[oi4Id].eventList.length} Events:`}</h3>
                              <TextField
                                id='filterText'
                                value={this.state.filterWordEvent}
                                onChange={this.handleFilterEventChange.bind(this)}
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
                                style={{ marginLeft: '10px', minWidth: '80px', maxWidth: '200px' }}
                                color='secondary'
                              />
                            </Grid> */}
                                <Grid item xs={12}>
                                  {this.displayLocalEvents(this.props.assetLookup[oi4Id].eventList.filter((item) => {
                                    if (this.state.filterWordEvent === '') return true;
                                    if (item.origin.includes(this.state.filterWordEvent)) return true;
                                    if (item.description.includes(this.state.filterWordEvent)) return true;
                                    if (item.number.toString().includes(this.state.filterWordEvent)) return true;
                                    if (JSON.stringify(item.details).includes(this.state.filterWordEvent)) return true;
                                    return false;
                                  }))}
                                </Grid>
                              </Grid>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        </>
    );
  }

  filterAssets() {
    // TODO: This was a bit hard to get back into, maybe it can be simplified
    // Filter assetList to be displayed
    const filteredAssets = Object.keys(this.props.assetLookup) // TODO: Maybe get this to another place?
        .filter((key) => {
          if (this.state.filterWord === '') {
            return true;
          }
          Object.keys(this.props.assetLookup[key].resources.mam).forEach(items => {
            if (items === 'Manufacturer') {
              try {
                if (this.props.assetLookup[key].resources.mam[items].text.includes(this.state.filterWord)) {
                  return true;
                }
              } catch {
                return true;
              }
            }
            if (typeof this.props.assetLookup[key].resources.mam[items] === 'string') { // No try-catch like above necessary, because we already check for string type
              if (this.props.assetLookup[key].resources.mam[items].includes(this.state.filterWord)) {
                return true;
              }
            }
          });
          return false;
        }) // Filter only keeps the oi4Ids of the assets passing through it
        .reduce((obj, key) => { // Reduce creates an array with actual assets from the oi4Ids
          obj[key] = this.props.assetLookup[key];
          return obj;
        }, {});
    return filteredAssets;
  }

  /**
   * Checks whether the resource is available in the lookup and returns it
   * @param {string} oi4Id - The oi4Id that si to be looked up
   * @param {string} resource - The resource that will be displayed if the lookup succeedes
   * @returns The requested resource, if found. An error, if not
   * @memberof ExpansionTableDetail
   */
  getResourceObject(oi4Id, resource) {
    const lookup = this.props.assetLookup;
    if (resource in lookup[oi4Id].resources) {
      return lookup[oi4Id].resources[resource];
    }
    return 'Error - getResourceObject: resource not found in lookup';
  }

  /**
   * Checks if the health property of the payload is available and prints it, if yes.
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
    if ('Health' in lookup[oi4Id].resources) {
      if ('Health' in lookup[oi4Id].resources.Health) {
        return lookup[oi4Id].resources.Health.Health;
      }
    }
    return 'Error - getHealth: Health string not found in lookup';
  }

  /**
   * Checks the state of the expansion of the table and returns the corresponding icon
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
   * @param {string} status The healthstatus according to NAMUR spec
   * @param {string} [height='25']
   * @param {string} [width='25']
   * @returns An image of the NAMUR health, if the status is valid. 'Undefined NamurHealth', if it is not
   * @memberof ExpansionTable
   */
  displayNamurHealth(status, height = '25', width = '25') {
    if (!(status in this.state.namurLookup)) {
      return 'Undefined NamurHealth';
    } else {
      return <img src={this.state.namurLookup[status]} alt="Namur" height={height} width={width} />;
    }
  }

  displayAASIcon(oi4Id, height = '25', width = '25') {
    const lookup = this.props.assetLookup;
    if ('AAS' in lookup[oi4Id].resources) {
      return <img src={aas_img} alt="AAS" height={height} width={width} />;
    }
    return '';
  }

  /**
   * Displays the Events / Events coming from either global or local data sources
   * @param {array} eventArray - an array of the last few events
   */
  displayLocalEvents(eventArray) {
    const newArray = [];
    eventArray.forEach(item => {
      newArray.push({
        level: item.level,
        number: item.number,
        description: item.description,
        category: item.category,
        details: JSON.stringify(item.details),
      });
    });
    if (Array.isArray(eventArray)) {
      if (eventArray.length !== 0) {
        return (
            <MaterialTable
                columns={[
                  { title: "Level", field: "level", width: '8%', cellStyle: { wordBreak: 'break-all' } },
                  { title: "Number", field: "number", width: '8%', cellStyle: { wordBreak: 'break-all' } },
                  { title: "Category", field: "category", width: '13%', cellStyle: { wordBreak: 'break-all' } },
                  { title: "Description", field: "description", width: '0px', cellStyle: { wordBreak: 'break-all' } },
                  { title: 'Details', field: 'details', cellStyle: { wordBreak: 'break-all' } }
                ]}
                style={{ minWidth: '100%' }}
                data={newArray}
                title={<span>{`Last ${eventArray.length} Events:`}
                  <span style={{ marginRight: '1%' }}>
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
                    message='Saved Local Events to clipboard'
                    action={
                      <>
                        <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
                          <Close fontSize='small' />
                        </IconButton>
                      </>
                    }
                />
              </span>
            </span>}
            />);
      } else {
        return <h3>No items in event list...</h3>;
      }

      // return <Grid item xs={3}><Table style={{ width: 'auto', tableLayout: 'auto' }}>
      //   <TableHead>
      //     <TableRow>
      //       <TableCell>
      //         <span style={{ marginRight: '1%' }}>
      //           <Tooltip title="Copy to clipboard">
      //             <IconButton
      //               size='small'
      //               color='default'
      //               onClick={() => {
      //                 navigator.clipboard.writeText(JSON.stringify(eventArray, null, 2)).then(() => {
      //                   this.setState({ copySnackOpen: true });
      //                 });
      //               }}
      //             >
      //               <FileCopy />
      //             </IconButton>
      //           </Tooltip>
      //           <Snackbar
      //             open={this.state.copySnackOpen}
      //             anchorOrigin={{
      //               vertical: 'bottom',
      //               horizontal: 'center',
      //             }}
      //             onClose={() => { this.setState({ copySnackOpen: false }) }}
      //             autoHideDuration={5000}
      //             message='Saved Local Events to clipboard'
      //             action={
      //               <>
      //                 <IconButton size='small' color='inherit' onClick={() => { this.setState({ copySnackOpen: false }) }}>
      //                   <Close fontSize='small' />
      //                 </IconButton>
      //               </>
      //             }
      //           />
      //         </span>
      //         ErrorCode</TableCell>
      //       <TableCell>Description</TableCell>
      //       <TableCell>Payload</TableCell>
      //     </TableRow>
      //   </TableHead>
      //   <TableBody>
      //     {
      //       eventArray.map((events, idx) => {
      //         return <TableRow key={`LocalEvents-${idx}`}>
      //           <TableCell>{events.number}</TableCell>
      //           <TableCell component="th" scope="row" style={{ width: '35%' }}>{events.description}</TableCell>
      //           <TableCell>{JSON.stringify(events.payload)}</TableCell>
      //         </TableRow>;
      //       })
      //     }
      //   </TableBody>
      // </Table></Grid>;
    }
  }

  /**
   * Callback handler in order to update the conformity of a buttonpress.
   * Calls the parent callback to handle the function.
   * @param {string} fullTopic
   * @param {string} oi4Id
   * @memberof ExpansionTable
   */
  updateConformity(fullTopic, oi4Id) {
    console.log(`Updating Conformity for ${fullTopic} with oi4Id: ${oi4Id} FROM EXPANSTIONTABLE COMPONENT`);
    this.props.updateConformity(fullTopic, oi4Id);
  }

  handleFilterChange(ev) {
    this.setState({ filterWord: ev.target.value });
  }

  handleFilterEventChange(ev) {
    this.setState({ filterWordEvent: ev.target.value });
  }
}

ExpansionTable.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(ExpansionTable);
