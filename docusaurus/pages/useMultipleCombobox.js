import * as React from 'react'

import {useCombobox, useMultipleSelection} from '../../src'
import {
  colors,
  containerStyles,
  menuStyles,
  selectedItemsContainerSyles,
  selectedItemStyles,
} from '../utils'

const initialSelectedItems = [colors[0], colors[1]]

function getFilteredItems(selectedItems, inputValue) {
  const lowerCasedInputValue = inputValue.toLowerCase()

  return colors.filter(
    colour =>
      !selectedItems.includes(colour) &&
      colour.toLowerCase().startsWith(lowerCasedInputValue),
  )
}

export default function DropdownMultipleCombobox() {
  const [inputValue, setInputValue] = React.useState('')
  const [selectedItems, setSelectedItems] = React.useState(initialSelectedItems)
  const items = React.useMemo(
    () => getFilteredItems(selectedItems, inputValue),
    [selectedItems, inputValue],
  )

  const {getSelectedItemProps, getDropdownProps, removeSelectedItem} =
    useMultipleSelection({
      selectedItems,
      onStateChange({selectedItems: newSelectedItems, type}) {
        switch (type) {
          case useMultipleSelection.stateChangeTypes
            .SelectedItemKeyDownBackspace:
          case useMultipleSelection.stateChangeTypes.SelectedItemKeyDownDelete:
          case useMultipleSelection.stateChangeTypes.DropdownKeyDownBackspace:
          case useMultipleSelection.stateChangeTypes.FunctionRemoveSelectedItem:
            setSelectedItems(newSelectedItems)
            break
          default:
            break
        }
      },
    })
  const {
    isOpen,
    getToggleButtonProps,
    getLabelProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    selectedItem,
    clearSelection,
  } = useCombobox({
    items,
    inputValue,
    selectedItem: null,
    stateReducer(state, actionAndChanges) {
      const {changes, type} = actionAndChanges

      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
        case useCombobox.stateChangeTypes.InputBlur:
          return {
            ...changes,
            ...(changes.selectedItem && {isOpen: true, highlightedIndex: 0}),
          }
        default:
          return changes
      }
    },
    onStateChange({
      inputValue: newInputValue,
      type,
      selectedItem: newSelectedItem,
    }) {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          setSelectedItems([...selectedItems, newSelectedItem])

          break
        case useCombobox.stateChangeTypes.InputChange:
          setInputValue(newInputValue)
          break
        default:
          break
      }
    },
  })
  return (
    <div style={containerStyles}>
      <label
        style={{
          fontWeight: 'bolder',
          color: selectedItem ? selectedItem : 'black',
        }}
        {...getLabelProps()}
      >
        Choose an element:
      </label>
      <div style={selectedItemsContainerSyles}>
        {selectedItems.map(function renderSelectedItem(
          selectedItemForRender,
          index,
        ) {
          return (
            <span
              style={selectedItemStyles}
              key={`selected-item-${index}`}
              {...getSelectedItemProps({
                selectedItem: selectedItemForRender,
                index,
              })}
            >
              {selectedItemForRender}
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
              <span
                style={{padding: '4px', cursor: 'pointer'}}
                onClick={e => {
                  e.stopPropagation()
                  removeSelectedItem(null)
                }}
              >
                &#10005;
              </span>
            </span>
          )
        })}
        <div>
          <input
            style={{padding: '4px'}}
            {...getInputProps(getDropdownProps({preventKeyAction: isOpen}))}
            data-testid="combobox-input"
          />
          <button
            style={{padding: '4px 8px'}}
            aria-label="toggle menu"
            data-testid="combobox-toggle-button"
            {...getToggleButtonProps()}
          >
            {isOpen ? <>&#8593;</> : <>&#8595;</>}
          </button>
          <button
            style={{padding: '4px 8px'}}
            aria-label="clear selection"
            data-testid="clear-button"
            onClick={clearSelection}
          >
            &#10007;
          </button>
        </div>
      </div>
      <ul {...getMenuProps()} style={menuStyles}>
        {isOpen
          ? items.map((item, index) => (
              <li
                style={{
                  padding: '4px',
                  backgroundColor:
                    highlightedIndex === index ? '#bde4ff' : null,
                }}
                key={`${item}${index}`}
                {...getItemProps({
                  item,
                  index,
                  'data-testid': `downshift-item-${index}`,
                })}
              >
                {item}
              </li>
            ))
          : null}
      </ul>
    </div>
  )
}
